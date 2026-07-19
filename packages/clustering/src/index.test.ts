/**
 * Cross-cutting integration tests for @atlas/clustering.
 *
 * Everything here imports through the package's public entry point (./index.js)
 * — the same surface downstream consumers see — and asserts that every exported
 * Clusterer produces a contract-valid, deterministic ClusterResult on the shared
 * deterministic fixtures. Per-algorithm behaviour lives in the sibling unit
 * tests; this file guards that the pieces compose correctly end to end.
 */

import { describe, expect, it } from "vitest";
import type { Block, Clusterer, ClusterResult } from "./index.js";
import {
  HdbscanClusterer,
  KMeansClusterer,
  LouvainClusterer,
  MockEmbeddingIndex,
  StableClusterer,
  fixtureBlocks,
} from "./index.js";

/** Fresh instances every call so "determinism across runs" uses independent state. */
function makeClusterers(): Array<{ name: string; make: () => Clusterer }> {
  return [
    { name: "LouvainClusterer", make: () => new LouvainClusterer() },
    { name: "KMeansClusterer", make: () => new KMeansClusterer() },
    { name: "HdbscanClusterer", make: () => new HdbscanClusterer() },
    { name: "StableClusterer(Louvain)", make: () => new StableClusterer(new LouvainClusterer()) },
  ];
}

/** Assert a ClusterResult fully honours the frozen Clusterer/ClusterResult contract. */
function assertValidResult(result: ClusterResult, blocks: Block[]): void {
  const allIds = blocks.map((b) => b.id);
  const idSet = new Set(allIds);

  // method is one of the frozen ClusterMethod literals.
  expect(["louvain", "leiden", "kmeans", "hdbscan", "connected-components"]).toContain(
    result.method,
  );

  // full, non-overlapping coverage: every block in exactly one cluster.
  const covered = result.clusters.flatMap((c) => c.blockIds);
  expect(covered.slice().sort()).toEqual(allIds.slice().sort());
  expect(new Set(covered).size).toBe(covered.length);

  // dense cluster ids: 0..K-1 with no gaps.
  const ids = result.clusters.map((c) => c.id).sort((a, b) => a - b);
  expect(ids).toEqual(result.clusters.map((_, i) => i));

  // overall quality is a finite number within the documented [0, 1] range.
  expect(Number.isFinite(result.quality)).toBe(true);
  expect(result.quality).toBeGreaterThanOrEqual(0);
  expect(result.quality).toBeLessThanOrEqual(1);

  for (const cluster of result.clusters) {
    expect(cluster.blockIds.length).toBeGreaterThan(0);
    for (const id of cluster.blockIds) expect(idSet.has(id)).toBe(true);

    expect(cluster.cohesion).toBeGreaterThanOrEqual(0);
    expect(cluster.cohesion).toBeLessThanOrEqual(1);

    if (cluster.centroidBlockId !== undefined) {
      // the representative must be a genuine member of its own cluster.
      expect(cluster.blockIds).toContain(cluster.centroidBlockId);
    }
  }

  // hard assignment agrees with the cluster listing for every block.
  const clusterOf = new Map<string, number>();
  for (const c of result.clusters) for (const id of c.blockIds) clusterOf.set(id, c.id);
  for (const id of allIds) {
    expect(result.assignment[id]).toBe(clusterOf.get(id));
  }

  // soft memberships (optional) reference real blocks/clusters with valid weights.
  if (result.memberships) {
    const validClusterIds = new Set(result.clusters.map((c) => c.id));
    for (const m of result.memberships) {
      expect(idSet.has(m.blockId)).toBe(true);
      expect(validClusterIds.has(m.clusterId)).toBe(true);
      expect(m.weight).toBeGreaterThan(0);
      expect(m.weight).toBeLessThanOrEqual(1);
    }
  }
}

describe("@atlas/clustering integration", () => {
  it("re-exports the whole public surface from index", () => {
    expect(typeof LouvainClusterer).toBe("function");
    expect(typeof KMeansClusterer).toBe("function");
    expect(typeof HdbscanClusterer).toBe("function");
    expect(typeof StableClusterer).toBe("function");
    expect(typeof MockEmbeddingIndex).toBe("function");
    expect(Array.isArray(fixtureBlocks)).toBe(true);
    expect(fixtureBlocks.length).toBeGreaterThan(0);
  });

  for (const { name, make } of makeClusterers()) {
    describe(name, () => {
      it("returns a contract-valid result on the fixtures (no index)", () => {
        assertValidResult(make().cluster(fixtureBlocks), fixtureBlocks);
      });

      it("returns a contract-valid result using the MockEmbeddingIndex", () => {
        const index = new MockEmbeddingIndex(fixtureBlocks);
        assertValidResult(make().cluster(fixtureBlocks, index), fixtureBlocks);
      });

      it("is deterministic across independent runs (with and without index)", () => {
        const a = make().cluster(fixtureBlocks);
        const b = make().cluster(fixtureBlocks);
        expect(b).toEqual(a);

        const idx1 = new MockEmbeddingIndex(fixtureBlocks);
        const idx2 = new MockEmbeddingIndex(fixtureBlocks);
        expect(make().cluster(fixtureBlocks, idx2)).toEqual(
          make().cluster(fixtureBlocks, idx1),
        );
      });

      it("handles empty input without throwing", () => {
        const result = make().cluster([]);
        expect(result.clusters).toEqual([]);
        expect(result.quality).toBe(0);
        assertValidResult(result, []);
      });

      it("exposes a method matching its produced result", () => {
        const c = make();
        expect(c.cluster(fixtureBlocks).method).toBe(c.method);
      });
    });
  }

  it("never collapses the fixtures into a single cluster", () => {
    const index = new MockEmbeddingIndex(fixtureBlocks);
    for (const { make } of makeClusterers()) {
      const result = make().cluster(fixtureBlocks, index);
      // a meaningful partition must find structure, not one blob.
      expect(result.clusters.length).toBeGreaterThan(1);
    }
  });

  it("recovers the two planted communities with the Louvain-based clusterers", () => {
    const index = new MockEmbeddingIndex(fixtureBlocks);
    for (const make of [
      () => new LouvainClusterer(),
      () => new StableClusterer(new LouvainClusterer()),
    ]) {
      const { assignment } = make().cluster(fixtureBlocks, index);
      // the graph trio (g*) and the ai trio (a*) sit in different clusters.
      expect(assignment.g1).toBe(assignment.g2);
      expect(assignment.g2).toBe(assignment.g3);
      expect(assignment.a1).toBe(assignment.a2);
      expect(assignment.g1).not.toBe(assignment.a1);
    }
  });

  it("keeps the graph trio together under embedding k-means", () => {
    const index = new MockEmbeddingIndex(fixtureBlocks);
    const { assignment } = new KMeansClusterer({ k: 2 }).cluster(fixtureBlocks, index);
    expect(assignment.g1).toBe(assignment.g3);
  });

  it("MockEmbeddingIndex satisfies the EmbeddingIndex contract deterministically", async () => {
    const index = new MockEmbeddingIndex(fixtureBlocks);
    const embedded = await index.sync(fixtureBlocks);
    expect(embedded).toBe(fixtureBlocks.length);
    expect(index.all().map((r) => r.blockId)).toEqual(
      fixtureBlocks.map((b) => b.id).sort(),
    );

    for (const b of fixtureBlocks) {
      const rec = index.get(b.id);
      expect(rec).toBeDefined();
      expect(rec!.model).toBe("mock-bow-v1");
      // self-similarity is maximal; range is respected.
      expect(index.similarity(b.id, b.id)).toBeCloseTo(1, 6);
    }

    // symmetric similarity and a well-ordered nearest list.
    expect(index.similarity("g1", "a1")).toBeCloseTo(index.similarity("a1", "g1"), 12);
    const nearest = index.nearest("g1", 3);
    expect(nearest.length).toBe(3);
    const scores = nearest.map((n) => n.score);
    expect(scores.slice().sort((x, y) => y - x)).toEqual(scores);
    for (const s of scores) {
      expect(s).toBeGreaterThanOrEqual(-1);
      expect(s).toBeLessThanOrEqual(1);
    }

    // guards: unknown id and non-positive k yield empty results.
    expect(index.nearest("nope", 3)).toEqual([]);
    expect(index.nearest("g1", 0)).toEqual([]);
    expect(index.similarity("g1", "nope")).toBe(0);
  });

  it("StableClusterer keeps ids stable as the graph grows", () => {
    const stable = new StableClusterer(new LouvainClusterer());
    const first = stable.cluster(fixtureBlocks);
    const graphId = first.assignment.g1;

    const grown: Block[] = [
      ...fixtureBlocks,
      {
        id: "g4",
        parentId: null,
        order: 0,
        type: "text",
        content: "Another [[g1]] note about knowledge graphs and pkm structure.",
        props: { tags: ["graph", "pkm"] },
        createdAt: 0,
        updatedAt: 0,
      },
    ];
    const second = stable.cluster(grown);
    assertValidResult(second, grown);
    expect(second.assignment.g1).toBe(graphId);
    expect(second.assignment.g4).toBe(second.assignment.g1);
  });
});
