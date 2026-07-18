/**
 * GraphRAG retrieval: vector search over blocks, then an n-hop expansion along
 * the knowledge graph so the answer sees each hit's neighbourhood.
 */
import type {
  AIProvider,
  Block,
  BlockId,
  Edge,
  EditorStore,
  RetrievedContext,
  Retriever,
} from "@atlas/contracts";
import { cosine } from "./cosine.js";

/** How many top-scoring blocks to seed the retrieval with before expansion. */
export const DEFAULT_TOP_K = 4;
/** How many graph hops to expand outward from the seeds. */
export const DEFAULT_HOPS = 1;

/** Tuning for {@link createRetriever}. */
export interface RetrieverOptions {
  /** number of top cosine hits to seed with (default {@link DEFAULT_TOP_K}). */
  topK?: number;
  /** graph hops to expand from the seeds; 0 = vector search only (default {@link DEFAULT_HOPS}). */
  hops?: number;
}

/** Accept a bare topK (legacy) or a full options object. */
function normalizeOptions(opts: number | RetrieverOptions = {}): Required<RetrieverOptions> {
  const o = typeof opts === "number" ? { topK: opts } : opts;
  return {
    topK: Math.max(0, o.topK ?? DEFAULT_TOP_K),
    hops: Math.max(0, o.hops ?? DEFAULT_HOPS),
  };
}

interface ScoredBlock {
  block: Block;
  score: number;
}

/** Rank every block in the store against the query embedding by cosine. */
async function scoreBlocks(
  query: string,
  blocks: Block[],
  provider: AIProvider,
): Promise<ScoredBlock[]> {
  if (blocks.length === 0) return [];
  const [queryVec, ...blockVecs] = await provider.embed([
    query,
    ...blocks.map((b) => b.content),
  ]);
  return blocks
    .map((block, i) => ({ block, score: cosine(queryVec, blockVecs[i] ?? []) }))
    .sort((a, b) => b.score - a.score);
}

/** Build an undirected adjacency map from the edge list. */
function adjacency(edges: Edge[]): Map<BlockId, BlockId[]> {
  const adj = new Map<BlockId, BlockId[]>();
  const link = (a: BlockId, b: BlockId) => {
    const list = adj.get(a);
    if (list) list.push(b);
    else adj.set(a, [b]);
  };
  for (const e of edges) {
    link(e.srcBlockId, e.dstBlockId);
    link(e.dstBlockId, e.srcBlockId);
  }
  return adj;
}

export function createRetriever(
  store: EditorStore,
  provider: AIProvider,
  options: number | RetrieverOptions = {},
): Retriever {
  const { topK, hops } = normalizeOptions(options);
  return {
    async retrieve(query: string): Promise<RetrievedContext> {
      const blocks = store.listBlocks();
      const adj = adjacency(store.listEdges());
      const ranked = await scoreBlocks(query, blocks, provider);
      const seeds = ranked.slice(0, topK);

      // path records the traversal order: seeds first (BFS frontier 0), then
      // each successive hop's newly discovered nodes, so the graph can
      // highlight exactly what was read and in what order.
      const path: BlockId[] = [];
      const seen = new Set<BlockId>();
      const add = (id: BlockId): boolean => {
        if (seen.has(id)) return false;
        seen.add(id);
        path.push(id);
        return true;
      };

      let frontier: BlockId[] = [];
      for (const { block } of seeds) if (add(block.id)) frontier.push(block.id);

      for (let hop = 0; hop < hops && frontier.length > 0; hop++) {
        const next: BlockId[] = [];
        for (const id of frontier) {
          for (const nb of adj.get(id) ?? []) if (add(nb)) next.push(nb);
        }
        frontier = next;
      }

      const resultBlocks = path
        .map((id) => store.getBlock(id))
        .filter((b): b is Block => b !== undefined);

      return { blocks: resultBlocks, path };
    },
  };
}
