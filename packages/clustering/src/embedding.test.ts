import { describe, expect, it } from "vitest";
import type {
  Block,
  BlockId,
  ClusterResult,
  EmbeddingIndex,
  EmbeddingRecord,
} from "@atlas/contracts";
import { HdbscanClusterer, KMeansClusterer, hdbscan, kmeans } from "./embedding.js";
import { fixtureBlocks, MockEmbeddingIndex } from "./fixtures.js";

/* -------------------------------- helpers --------------------------------- */

function block(id: string, content: string, tags: string[] = []): Block {
  return {
    id,
    parentId: null,
    order: 0,
    type: "text",
    content,
    props: { tags },
    createdAt: 0,
    updatedAt: 0,
  };
}

/** A minimal EmbeddingIndex serving caller-supplied vectors verbatim. */
class StaticIndex implements EmbeddingIndex {
  private records = new Map<BlockId, EmbeddingRecord>();
  constructor(vectors: Record<BlockId, number[]>) {
    for (const [id, vector] of Object.entries(vectors)) {
      this.records.set(id, { blockId: id, hash: "h", vector, model: "static", updatedAt: 0 });
    }
  }
  sync(): Promise<number> {
    return Promise.resolve(this.records.size);
  }
  get(id: BlockId): EmbeddingRecord | undefined {
    return this.records.get(id);
  }
  all(): EmbeddingRecord[] {
    return [...this.records.values()];
  }
  nearest(): Array<{ id: BlockId; score: number }> {
    return [];
  }
  similarity(): number {
    return 0;
  }
}

/** Structural invariants every ClusterResult must satisfy. */
function assertWellFormed(result: ClusterResult, blocks: Block[]): void {
  const ids = blocks.map((b) => b.id);
  // every block is covered exactly once across clusters
  const covered = result.clusters.flatMap((c) => c.blockIds).sort();
  expect(covered).toEqual([...ids].sort());
  // assignment map has an entry per block
  expect(Object.keys(result.assignment).sort()).toEqual([...ids].sort());
  // cluster ids are a dense 0..K-1 range, ascending
  const clusterIds = result.clusters.map((c) => c.id);
  expect(clusterIds).toEqual(clusterIds.slice().sort((a, b) => a - b));
  expect(new Set(clusterIds).size).toBe(clusterIds.length);
  if (clusterIds.length) {
    expect(Math.min(...clusterIds)).toBe(0);
    expect(Math.max(...clusterIds)).toBe(clusterIds.length - 1);
  }
  // assignment values agree with cluster membership and stay in range
  for (const c of result.clusters) {
    for (const id of c.blockIds) expect(result.assignment[id]).toBe(c.id);
    expect(c.cohesion).toBeGreaterThanOrEqual(0);
    expect(c.cohesion).toBeLessThanOrEqual(1 + 1e-9);
    if (c.centroidBlockId !== undefined) expect(c.blockIds).toContain(c.centroidBlockId);
  }
  expect(result.quality).toBeGreaterThanOrEqual(0);
  expect(result.quality).toBeLessThanOrEqual(1 + 1e-9);
  expect(Number.isFinite(result.quality)).toBe(true);
}

/* --------------------------------- k-means -------------------------------- */

describe("KMeansClusterer", () => {
  it("reports its method and covers every block", () => {
    const c = new KMeansClusterer({ k: 2 });
    expect(c.method).toBe("kmeans");
    const result = c.cluster(fixtureBlocks);
    assertWellFormed(result, fixtureBlocks);
  });

  it("produces k dense cluster ids", () => {
    const result = kmeans(fixtureBlocks, undefined, { k: 3 });
    const ids = new Set(result.clusters.map((c) => c.id));
    expect(ids.size).toBeLessThanOrEqual(3);
    expect([...ids].sort((a, b) => a - b)[0]).toBe(0);
  });

  it("uses the embedding index and is deterministic", () => {
    const index = new MockEmbeddingIndex(fixtureBlocks);
    const a = kmeans(fixtureBlocks, index, { k: 2 });
    const b = kmeans(fixtureBlocks, index, { k: 2 });
    expect(a.assignment).toEqual(b.assignment);
    expect(a.quality).toBeGreaterThan(0);
  });

  it("keeps the closely-related graph notes together", () => {
    const index = new MockEmbeddingIndex(fixtureBlocks);
    const result = kmeans(fixtureBlocks, index, { k: 2 });
    expect(result.assignment.g1).toBe(result.assignment.g3);
    expect(result.clusters.length).toBeGreaterThan(1);
  });

  it("handles empty input", () => {
    const result = kmeans([]);
    expect(result.clusters).toEqual([]);
    expect(result.assignment).toEqual({});
    expect(result.quality).toBe(0);
    expect(result.method).toBe("kmeans");
  });

  it("handles a single block as one cohesive cluster", () => {
    const one = [block("solo", "a lone note about knowledge graphs")];
    const result = kmeans(one, undefined, { k: 3 });
    assertWellFormed(result, one);
    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0].cohesion).toBe(1);
    expect(result.clusters[0].centroidBlockId).toBe("solo");
  });

  it("clamps k to the number of blocks", () => {
    const result = kmeans(fixtureBlocks, undefined, { k: 999 });
    assertWellFormed(result, fixtureBlocks);
    expect(result.clusters.length).toBeLessThanOrEqual(fixtureBlocks.length);
  });

  it("chooses a sensible default k when none is given", () => {
    const result = kmeans(fixtureBlocks);
    assertWellFormed(result, fixtureBlocks);
    expect(result.clusters.length).toBeGreaterThanOrEqual(1);
  });

  it("sanitises fractional, zero and negative k", () => {
    for (const k of [0, -4, 2.9]) {
      const result = kmeans(fixtureBlocks, undefined, { k });
      assertWellFormed(result, fixtureBlocks);
      expect(result.clusters.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("tolerates zero iterations", () => {
    const result = kmeans(fixtureBlocks, undefined, { k: 3, maxIterations: 0 });
    assertWellFormed(result, fixtureBlocks);
  });

  it("groups all-identical vectors into a single cluster deterministically", () => {
    const blocks = ["x1", "x2", "x3", "x4"].map((id) => block(id, "same"));
    const index = new StaticIndex({
      x1: [1, 0, 1],
      x2: [1, 0, 1],
      x3: [1, 0, 1],
      x4: [1, 0, 1],
    });
    const a = kmeans(blocks, index, { k: 2 });
    const b = kmeans(blocks, index, { k: 2 });
    assertWellFormed(a, blocks);
    expect(a.assignment).toEqual(b.assignment);
    expect(new Set(Object.values(a.assignment)).size).toBe(1);
  });

  it("handles blocks with no usable tokens (zero-dimensional vectors)", () => {
    const blocks = [block("e1", "a", []), block("e2", "of", []), block("e3", "", [])];
    const result = kmeans(blocks, undefined, { k: 2 });
    assertWellFormed(result, blocks);
  });

  it("replaces non-finite vector components rather than throwing", () => {
    const blocks = ["n1", "n2", "n3"].map((id) => block(id, id));
    const index = new StaticIndex({
      n1: [Number.NaN, 1, 0],
      n2: [0, 1, 0],
      n3: [Infinity, 0, 1],
    });
    const result = kmeans(blocks, index, { k: 2 });
    assertWellFormed(result, blocks);
  });

  it("stays deterministic across seeds but remains well-formed", () => {
    const index = new MockEmbeddingIndex(fixtureBlocks);
    const seedZeroA = kmeans(fixtureBlocks, index, { k: 3, seed: 0 });
    const seedZeroB = kmeans(fixtureBlocks, index, { k: 3, seed: 0 });
    const seedThree = kmeans(fixtureBlocks, index, { k: 3, seed: 3 });
    expect(seedZeroA.assignment).toEqual(seedZeroB.assignment);
    assertWellFormed(seedThree, fixtureBlocks);
    // out-of-range / negative seeds wrap deterministically without error
    assertWellFormed(kmeans(fixtureBlocks, index, { k: 3, seed: -1 }), fixtureBlocks);
    assertWellFormed(kmeans(fixtureBlocks, index, { k: 3, seed: 42 }), fixtureBlocks);
  });

  it("falls back to bag-of-words when the index has no vectors", () => {
    const empty = new StaticIndex({});
    const withIndex = kmeans(fixtureBlocks, empty, { k: 2 });
    const withoutIndex = kmeans(fixtureBlocks, undefined, { k: 2 });
    expect(withIndex.assignment).toEqual(withoutIndex.assignment);
  });

  it("zero-fills blocks missing from the index and still covers them", () => {
    const partial = new StaticIndex({ g1: [1, 0, 0, 0], g2: [1, 1, 0, 0], g3: [1, 0, 1, 0] });
    const result = kmeans(fixtureBlocks, partial, { k: 2 });
    assertWellFormed(result, fixtureBlocks);
  });
});

/* ------------------------------- HDBSCAN-style ----------------------------- */

describe("HdbscanClusterer", () => {
  it("reports its method and covers every block", () => {
    const c = new HdbscanClusterer();
    expect(c.method).toBe("hdbscan");
    const result = c.cluster(fixtureBlocks, new MockEmbeddingIndex(fixtureBlocks));
    assertWellFormed(result, fixtureBlocks);
  });

  it("is deterministic", () => {
    const index = new MockEmbeddingIndex(fixtureBlocks);
    const a = hdbscan(fixtureBlocks, index);
    const b = hdbscan(fixtureBlocks, index);
    expect(a.assignment).toEqual(b.assignment);
    assertWellFormed(a, fixtureBlocks);
  });

  it("handles empty input", () => {
    const result = hdbscan([]);
    expect(result.clusters).toEqual([]);
    expect(result.assignment).toEqual({});
    expect(result.quality).toBe(0);
    expect(result.method).toBe("hdbscan");
  });

  it("handles a single block", () => {
    const one = [block("solo", "one note")];
    const result = hdbscan(one);
    assertWellFormed(result, one);
    expect(result.clusters).toHaveLength(1);
  });

  it("finds more than one cluster in the two-community fixture", () => {
    const index = new MockEmbeddingIndex(fixtureBlocks);
    const result = hdbscan(fixtureBlocks, index);
    assertWellFormed(result, fixtureBlocks);
    expect(result.clusters.length).toBeGreaterThan(1);
  });

  it("emits singleton clusters when minClusterSize exceeds the data", () => {
    const result = hdbscan(fixtureBlocks, new MockEmbeddingIndex(fixtureBlocks), {
      minClusterSize: 999,
    });
    assertWellFormed(result, fixtureBlocks);
    expect(result.clusters).toHaveLength(fixtureBlocks.length);
    expect(result.clusters.every((c) => c.blockIds.length === 1)).toBe(true);
  });

  it("sanitises minClusterSize below the floor", () => {
    const result = hdbscan(fixtureBlocks, undefined, { minClusterSize: 0 });
    assertWellFormed(result, fixtureBlocks);
  });

  it("groups all-identical vectors together", () => {
    const blocks = ["x1", "x2", "x3"].map((id) => block(id, "same"));
    const index = new StaticIndex({ x1: [1, 1], x2: [1, 1], x3: [1, 1] });
    const result = hdbscan(blocks, index);
    assertWellFormed(result, blocks);
    expect(new Set(Object.values(result.assignment)).size).toBe(1);
  });

  it("handles zero-dimensional vectors without throwing", () => {
    const blocks = [block("e1", "a"), block("e2", "of"), block("e3", "")];
    const result = hdbscan(blocks);
    assertWellFormed(result, blocks);
  });

  it("replaces non-finite vector components rather than throwing", () => {
    const blocks = ["n1", "n2"].map((id) => block(id, id));
    const index = new StaticIndex({ n1: [Number.NaN, 1], n2: [1, Infinity] });
    const result = hdbscan(blocks, index);
    assertWellFormed(result, blocks);
  });

  it("falls back to bag-of-words when the index has no vectors", () => {
    const withIndex = hdbscan(fixtureBlocks, new StaticIndex({}));
    const withoutIndex = hdbscan(fixtureBlocks, undefined);
    expect(withIndex.assignment).toEqual(withoutIndex.assignment);
  });
});
