/**
 * (f) Deterministic fixtures for tests and demos: a tiny two-community block set
 * plus an in-memory EmbeddingIndex whose vectors are derived from block content
 * (no network, fully reproducible).
 */

import type { Block, BlockId, EmbeddingIndex, EmbeddingRecord } from "@atlas/contracts";

const now = 0;

function block(id: string, content: string, tags: string[], parentId: string | null = null): Block {
  return {
    id,
    parentId,
    order: 0,
    type: "text",
    content,
    props: { tags },
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Two well-separated communities: a "graph/pkm" group (g1..g3, wikilinked) and
 * an "ai/embeddings" group (a1..a3, shared tags), plus a bridge block.
 */
export const fixtureBlocks: Block[] = [
  block("g1", "Knowledge [[g2]] graphs connect atomic notes into structure.", ["graph", "pkm"]),
  block("g2", "Bidirectional [[g3]] links create emergent structure over time.", ["graph", "pkm"]),
  block("g3", "A graph of notes becomes a navigable knowledge base.", ["graph", "pkm"]),
  block("a1", "Embeddings place semantically similar notes near each other.", ["ai", "embeddings"]),
  block("a2", "Vector search retrieves neighbours by cosine similarity.", ["ai", "embeddings"]),
  block("a3", "A language model summarises retrieved context for answers.", ["ai", "llm"]),
  block("bridge", "GraphRAG combines vector search with graph traversal.", ["ai", "graph"]),
];

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((t) => t.length > 2);
}

function bow(blocks: Block[]): { dim: number; vecs: Map<BlockId, number[]> } {
  const vocab = new Map<string, number>();
  for (const b of blocks) for (const t of tokenize(b.content)) if (!vocab.has(t)) vocab.set(t, vocab.size);
  const dim = vocab.size;
  const vecs = new Map<BlockId, number[]>();
  for (const b of blocks) {
    const v = new Array<number>(dim).fill(0);
    for (const t of tokenize(b.content)) v[vocab.get(t)!] += 1;
    vecs.set(b.id, v);
  }
  return { dim, vecs };
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let ma = 0;
  let mb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    ma += a[i] * a[i];
    mb += b[i] * b[i];
  }
  if (ma === 0 || mb === 0) return 0;
  const c = dot / (Math.sqrt(ma) * Math.sqrt(mb));
  // clamp away floating-point drift so scores stay in the documented [-1, 1].
  return c < -1 ? -1 : c > 1 ? 1 : c;
}

/**
 * Deterministic in-memory {@link EmbeddingIndex} over the supplied blocks.
 *
 * Vectors are bag-of-words counts over a shared vocabulary, so the same blocks
 * always produce byte-identical records (no network, no randomness). The last
 * write for a given block id wins, matching the incremental `sync` contract.
 */
export class MockEmbeddingIndex implements EmbeddingIndex {
  private records = new Map<BlockId, EmbeddingRecord>();

  constructor(blocks: Block[] = []) {
    if (blocks.length) this.rebuild(blocks);
  }

  private rebuild(blocks: Block[]): void {
    const { vecs } = bow(blocks);
    this.records.clear();
    for (const b of blocks) {
      this.records.set(b.id, {
        blockId: b.id,
        hash: String(b.content.length),
        vector: vecs.get(b.id) ?? [],
        model: "mock-bow-v1",
        updatedAt: now,
      });
    }
  }

  sync(blocks: Block[]): Promise<number> {
    this.rebuild(blocks);
    return Promise.resolve(blocks.length);
  }

  get(id: BlockId): EmbeddingRecord | undefined {
    return this.records.get(id);
  }

  all(): EmbeddingRecord[] {
    // stable, id-sorted order so callers get a reproducible listing.
    return [...this.records.values()].sort((a, b) => a.blockId.localeCompare(b.blockId));
  }

  nearest(id: BlockId, k: number): Array<{ id: BlockId; score: number }> {
    const self = this.records.get(id);
    if (!self || k <= 0) return [];
    const scored: Array<{ id: BlockId; score: number }> = [];
    for (const rec of this.records.values()) {
      if (rec.blockId === id) continue;
      scored.push({ id: rec.blockId, score: cosine(self.vector, rec.vector) });
    }
    scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    return scored.slice(0, k);
  }

  similarity(a: BlockId, b: BlockId): number {
    const ra = this.records.get(a);
    const rb = this.records.get(b);
    if (!ra || !rb) return 0;
    return cosine(ra.vector, rb.vector);
  }
}
