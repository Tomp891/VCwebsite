import { describe, expect, it } from "vitest";
import { HdbscanClusterer, KMeansClusterer, hdbscan, kmeans } from "./embedding.js";
import { fixtureBlocks, MockEmbeddingIndex } from "./fixtures.js";

describe("KMeansClusterer", () => {
  it("reports its method and covers every block", () => {
    const c = new KMeansClusterer({ k: 2 });
    expect(c.method).toBe("kmeans");
    const result = c.cluster(fixtureBlocks);
    const covered = result.clusters.flatMap((x) => x.blockIds).sort();
    expect(covered).toEqual(fixtureBlocks.map((b) => b.id).sort());
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
    expect(kmeans([]).clusters).toEqual([]);
  });
});

describe("HdbscanClusterer", () => {
  it("reports its method and covers every block", () => {
    const c = new HdbscanClusterer();
    expect(c.method).toBe("hdbscan");
    const result = c.cluster(fixtureBlocks, new MockEmbeddingIndex(fixtureBlocks));
    const covered = result.clusters.flatMap((x) => x.blockIds).sort();
    expect(covered).toEqual(fixtureBlocks.map((b) => b.id).sort());
  });

  it("is deterministic", () => {
    const index = new MockEmbeddingIndex(fixtureBlocks);
    const a = hdbscan(fixtureBlocks, index);
    const b = hdbscan(fixtureBlocks, index);
    expect(a.assignment).toEqual(b.assignment);
  });

  it("handles empty input", () => {
    expect(hdbscan([]).clusters).toEqual([]);
  });
});
