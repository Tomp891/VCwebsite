/**
 * GraphRAG retrieval: vector search over blocks, then a one-hop expansion along
 * the knowledge graph so the answer sees each hit's immediate neighbours.
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

/** Block ids one hop away from `id` in either direction. */
function neighbours(id: BlockId, edges: Edge[]): BlockId[] {
  const out: BlockId[] = [];
  for (const e of edges) {
    if (e.srcBlockId === id) out.push(e.dstBlockId);
    else if (e.dstBlockId === id) out.push(e.srcBlockId);
  }
  return out;
}

export function createRetriever(
  store: EditorStore,
  provider: AIProvider,
  topK: number = DEFAULT_TOP_K,
): Retriever {
  return {
    async retrieve(query: string): Promise<RetrievedContext> {
      const blocks = store.listBlocks();
      const edges = store.listEdges();
      const ranked = await scoreBlocks(query, blocks, provider);
      const seeds = ranked.slice(0, Math.max(0, topK));

      // path records the traversal order: seeds first, then newly discovered
      // one-hop neighbours, so the graph can highlight exactly what was read.
      const path: BlockId[] = [];
      const seen = new Set<BlockId>();
      const add = (id: BlockId) => {
        if (!seen.has(id)) {
          seen.add(id);
          path.push(id);
        }
      };

      for (const { block } of seeds) add(block.id);
      for (const { block } of seeds) {
        for (const nb of neighbours(block.id, edges)) add(nb);
      }

      const resultBlocks = path
        .map((id) => store.getBlock(id))
        .filter((b): b is Block => b !== undefined);

      return { blocks: resultBlocks, path };
    },
  };
}
