/**
 * Shared, deterministic test helpers for @atlas/autotag.
 *
 * `makeBlock` builds a minimal valid `Block`; `FakeEmbeddingIndex` is a tiny,
 * fully deterministic implementation of the `EmbeddingIndex` contract driven by
 * an explicit neighbour map so tests can exercise the semantic-recall path
 * without any embeddings, network, or randomness.
 */

import type {
  Block,
  BlockId,
  EmbeddingIndex,
  EmbeddingRecord,
} from "@atlas/contracts";

/** Build a minimal, valid Block for tests. */
export function makeBlock(id: string, content: string, tags?: string[]): Block {
  return {
    id,
    parentId: null,
    order: 0,
    type: "page",
    content,
    props: tags ? { tags } : {},
    createdAt: 0,
    updatedAt: 0,
  };
}

/** An explicit neighbour entry: which block, and its similarity score (0..1). */
export interface FakeNeighbour {
  id: BlockId;
  score: number;
}

/**
 * Deterministic EmbeddingIndex fake. `known` are the ids that have an embedding
 * (so `get` returns truthy and the recall code takes the index path);
 * `neighbours` maps a block id to its ordered nearest neighbours.
 */
export class FakeEmbeddingIndex implements EmbeddingIndex {
  private readonly known: Set<BlockId>;
  private readonly neighbours: Map<BlockId, FakeNeighbour[]>;

  constructor(
    known: BlockId[],
    neighbours: Record<BlockId, FakeNeighbour[]> = {},
  ) {
    this.known = new Set(known);
    this.neighbours = new Map(Object.entries(neighbours));
  }

  async sync(): Promise<number> {
    return this.known.size;
  }

  get(id: BlockId): EmbeddingRecord | undefined {
    if (!this.known.has(id)) return undefined;
    return { blockId: id, hash: `hash:${id}`, vector: [1, 0, 0] };
  }

  all(): EmbeddingRecord[] {
    return [...this.known].map((id) => ({
      blockId: id,
      hash: `hash:${id}`,
      vector: [1, 0, 0],
    }));
  }

  nearest(id: BlockId, k: number): FakeNeighbour[] {
    return (this.neighbours.get(id) ?? []).slice(0, k);
  }

  similarity(a: BlockId, b: BlockId): number {
    const found = (this.neighbours.get(a) ?? []).find((n) => n.id === b);
    return found ? found.score : 0;
  }
}
