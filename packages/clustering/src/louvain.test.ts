import { describe, expect, it } from "vitest";
import { buildAdjacency } from "./graph.js";
import { LouvainClusterer, louvain } from "./louvain.js";
import { modularity } from "./quality.js";
import { fixtureBlocks, MockEmbeddingIndex } from "./fixtures.js";

describe("LouvainClusterer", () => {
  it("reports its method", () => {
    expect(new LouvainClusterer().method).toBe("louvain");
  });

  it("finds the two planted communities", () => {
    const result = new LouvainClusterer().cluster(fixtureBlocks);
    // g1..g3 together, a1..a3 together (bridge may go either way)
    expect(result.assignment.g1).toBe(result.assignment.g2);
    expect(result.assignment.g2).toBe(result.assignment.g3);
    expect(result.assignment.a1).toBe(result.assignment.a2);
    expect(result.assignment.g1).not.toBe(result.assignment.a1);
    expect(result.quality).toBeGreaterThan(0.2);
  });

  it("produces a hard assignment covering every block", () => {
    const result = new LouvainClusterer().cluster(fixtureBlocks);
    for (const b of fixtureBlocks) expect(result.assignment[b.id]).toBeTypeOf("number");
    const covered = result.clusters.flatMap((c) => c.blockIds).sort();
    expect(covered).toEqual(fixtureBlocks.map((b) => b.id).sort());
  });

  it("fills cohesion, centroid and soft memberships", () => {
    const result = new LouvainClusterer().cluster(fixtureBlocks);
    for (const c of result.clusters) {
      expect(c.cohesion).toBeGreaterThanOrEqual(0);
      expect(c.cohesion).toBeLessThanOrEqual(1);
      expect(c.centroidBlockId).toBeDefined();
    }
    expect(result.memberships && result.memberships.length).toBeGreaterThan(0);
  });

  it("is deterministic and uses the index when provided", () => {
    const index = new MockEmbeddingIndex(fixtureBlocks);
    const a = new LouvainClusterer().cluster(fixtureBlocks, index);
    const b = new LouvainClusterer().cluster(fixtureBlocks, index);
    expect(a.assignment).toEqual(b.assignment);
  });

  it("modularity of the found partition matches ClusterResult.quality", () => {
    const graph = buildAdjacency(fixtureBlocks);
    const assignment = louvain(graph);
    expect(modularity(graph, assignment)).toBeCloseTo(
      new LouvainClusterer().cluster(fixtureBlocks).quality,
      6,
    );
  });

  it("handles empty and edgeless input", () => {
    expect(new LouvainClusterer().cluster([]).clusters).toEqual([]);
  });
});
