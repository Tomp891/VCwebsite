/**
 * GraphRAG retrieval pipeline.
 *
 * Stages (each optional/tunable via RetrieverOptions):
 *   1. Vector similarity — cosine of the query against block vectors. Vectors
 *      come from a cached, incremental EmbeddingIndex when provided (no O(N)
 *      re-embed per query); otherwise embedded inline via the AIProvider.
 *   2. Lexical (BM25) fusion — an exact-term channel blended with cosine.
 *   3. Graph-importance fusion — blend in a Ranker's centrality score so hub
 *      notes are preferred over peripheral ones at equal relevance.
 *   4. Topic routing — for broad questions, take the best few per cluster so a
 *      dense topic can't crowd out the rest.
 *   5. MMR selection — diversify the top-K to avoid near-duplicate context.
 *   6. Graph expansion — add one-hop neighbours, gated by edge confidence and
 *      capped per seed so low-confidence "pencil" edges don't flood context.
 * The traversal `path` is seed-first, ordered by blended score (importance-
 * ordered context mitigates "lost in the middle").
 */
import type {
  AIProvider,
  Block,
  BlockId,
  ClusterResult,
  Edge,
  EditorStore,
  EmbeddingIndex,
  Ranker,
  RetrievedContext,
  Retriever,
} from "@atlas/contracts";
import { cosine } from "./cosine.js";
import { bm25Scores } from "./lexical.js";
import { mmrSelect, type MmrCandidate } from "./mmr.js";

/** How many top-scoring blocks to seed the retrieval with before expansion. */
export const DEFAULT_TOP_K = 4;

export interface RetrieverOptions {
  topK?: number;
  /** cached/incremental vectors; avoids re-embedding every block per query. */
  index?: EmbeddingIndex;
  /** graph-importance ranker; its score is blended into relevance. */
  ranker?: Ranker;
  /** weight (0..1) of graph importance in the blended score. */
  rankWeight?: number;
  /** weight (0..1) of the BM25 lexical channel in the blended score. */
  lexicalWeight?: number;
  /** MMR trade-off: 1 = pure relevance, lower adds diversity. */
  mmrLambda?: number;
  /** drop one-hop neighbours whose edge confidence is below this. */
  minEdgeConfidence?: number;
  /** cap neighbours added per seed (highest-confidence first). */
  maxNeighboursPerSeed?: number;
  /** cluster assignment for topic-routed broad retrieval. */
  clusters?: ClusterResult;
  /** when routing, how many blocks to take from each cluster. */
  perClusterK?: number;
}

interface Scored {
  block: Block;
  score: number;
  vector: number[];
}

function normalizeOptions(opts?: number | RetrieverOptions): RetrieverOptions {
  if (typeof opts === "number") return { topK: opts };
  return opts ?? {};
}

/** Vector for each block: from the index when present, else freshly embedded. */
async function embedBlocks(
  query: string,
  blocks: Block[],
  provider: AIProvider,
  index?: EmbeddingIndex,
): Promise<{ queryVec: number[]; vectors: Map<BlockId, number[]> }> {
  const vectors = new Map<BlockId, number[]>();
  if (index) {
    for (const b of blocks) {
      const rec = index.get(b.id);
      if (rec) vectors.set(b.id, rec.vector);
    }
    // Blocks the index hasn't embedded yet (e.g. never synced): embed inline.
    const missing = blocks.filter((b) => !vectors.has(b.id));
    const [queryVec, ...missingVecs] = await provider.embed([
      query,
      ...missing.map((b) => b.content),
    ]);
    missing.forEach((b, i) => vectors.set(b.id, missingVecs[i] ?? []));
    return { queryVec, vectors };
  }
  const [queryVec, ...blockVecs] = await provider.embed([
    query,
    ...blocks.map((b) => b.content),
  ]);
  blocks.forEach((b, i) => vectors.set(b.id, blockVecs[i] ?? []));
  return { queryVec, vectors };
}

/** Block ids one hop from `id`, gated by edge confidence and ordered by it. */
function gatedNeighbours(
  id: BlockId,
  edges: Edge[],
  minConfidence: number,
  cap: number,
): BlockId[] {
  const scored: Array<{ id: BlockId; confidence: number }> = [];
  for (const e of edges) {
    if (e.confidence < minConfidence) continue;
    if (e.srcBlockId === id) scored.push({ id: e.dstBlockId, confidence: e.confidence });
    else if (e.dstBlockId === id) scored.push({ id: e.srcBlockId, confidence: e.confidence });
  }
  scored.sort((a, b) => b.confidence - a.confidence);
  return scored.slice(0, cap).map((s) => s.id);
}

export function createRetriever(
  store: EditorStore,
  provider: AIProvider,
  opts?: number | RetrieverOptions,
): Retriever {
  const {
    topK = DEFAULT_TOP_K,
    index,
    ranker,
    rankWeight = 0,
    lexicalWeight = 0,
    mmrLambda = 1,
    minEdgeConfidence = 0,
    maxNeighboursPerSeed = Infinity,
    clusters,
    perClusterK,
  } = normalizeOptions(opts);

  return {
    async retrieve(query: string): Promise<RetrievedContext> {
      const blocks = store.listBlocks();
      const edges = store.listEdges();
      if (blocks.length === 0) return { blocks: [], path: [] };

      const { queryVec, vectors } = await embedBlocks(query, blocks, provider, index);

      // 1. cosine relevance, clamped to [0, 1].
      const cosScore = new Map<BlockId, number>();
      for (const b of blocks) {
        cosScore.set(b.id, Math.max(0, cosine(queryVec, vectors.get(b.id) ?? [])));
      }

      // 2. lexical (BM25) fusion.
      const lex =
        lexicalWeight > 0
          ? bm25Scores(query, blocks.map((b) => ({ id: b.id, text: b.content })))
          : null;

      // 3. graph-importance fusion.
      const rank =
        ranker && rankWeight > 0
          ? new Map(ranker.rank(blocks).map((r) => [r.blockId, r.score]))
          : null;

      const scored: Scored[] = blocks.map((b) => {
        let score = cosScore.get(b.id) ?? 0;
        if (lex) score = (1 - lexicalWeight) * score + lexicalWeight * (lex.get(b.id) ?? 0);
        if (rank) score = (1 - rankWeight) * score + rankWeight * (rank.get(b.id) ?? 0);
        return { block: b, score, vector: vectors.get(b.id) ?? [] };
      });
      scored.sort((a, b) => b.score - a.score);

      // 4. topic routing: take the best few from each cluster, then fill.
      let pool = scored;
      if (clusters && perClusterK && perClusterK > 0) {
        const perCluster = new Map<number, Scored[]>();
        for (const s of scored) {
          const c = clusters.assignment[s.block.id] ?? -1;
          const arr = perCluster.get(c) ?? [];
          if (arr.length < perClusterK) {
            arr.push(s);
            perCluster.set(c, arr);
          }
        }
        const routed = [...perCluster.values()].flat();
        const routedIds = new Set(routed.map((s) => s.block.id));
        // routed first (breadth), then the rest of the global order to fill K.
        pool = [
          ...routed.sort((a, b) => b.score - a.score),
          ...scored.filter((s) => !routedIds.has(s.block.id)),
        ];
      }

      // 5. MMR-diversified seed selection.
      const candidates: MmrCandidate<Scored>[] = pool.map((s) => ({
        item: s,
        relevance: s.score,
        vector: s.vector,
      }));
      const seeds = mmrSelect(candidates, Math.max(0, topK), mmrLambda);

      // 6. seed-first path, then gated one-hop neighbours.
      const path: BlockId[] = [];
      const seen = new Set<BlockId>();
      const add = (id: BlockId) => {
        if (!seen.has(id)) {
          seen.add(id);
          path.push(id);
        }
      };
      for (const s of seeds) add(s.block.id);
      for (const s of seeds) {
        for (const nb of gatedNeighbours(s.block.id, edges, minEdgeConfidence, maxNeighboursPerSeed)) {
          add(nb);
        }
      }

      const resultBlocks = path
        .map((id) => store.getBlock(id))
        .filter((b): b is Block => b !== undefined);

      return { blocks: resultBlocks, path };
    },
  };
}
