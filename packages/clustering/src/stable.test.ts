import { describe, expect, it } from "vitest";
import type { ClusterResult } from "@atlas/contracts";
import { StableClusterer, stabilizeClusterIds } from "./stable.js";
import { LouvainClusterer } from "./louvain.js";
import { fixtureBlocks } from "./fixtures.js";

function result(clusters: Array<{ id: number; blockIds: string[] }>): ClusterResult {
  const assignment: Record<string, number> = {};
  for (const c of clusters) for (const b of c.blockIds) assignment[b] = c.id;
  return {
    method: "louvain",
    clusters: clusters.map((c) => ({ ...c, cohesion: 1 })),
    assignment,
    quality: 1,
  };
}

describe("stabilizeClusterIds", () => {
  it("keeps prev ids for overlapping clusters even if labels shuffle", () => {
    const prev = result([
      { id: 0, blockIds: ["a", "b", "c"] },
      { id: 1, blockIds: ["d", "e"] },
    ]);
    // same communities but ids swapped by the algorithm
    const next = result([
      { id: 0, blockIds: ["d", "e"] },
      { id: 1, blockIds: ["a", "b", "c"] },
    ]);
    const { result: stable } = stabilizeClusterIds(prev, next);
    expect(stable.assignment.a).toBe(0);
    expect(stable.assignment.d).toBe(1);
  });

  it("assigns fresh ids to genuinely new clusters", () => {
    const prev = result([{ id: 0, blockIds: ["a", "b"] }]);
    const next = result([
      { id: 0, blockIds: ["a", "b"] },
      { id: 1, blockIds: ["x", "y"] },
    ]);
    const { result: stable, nextFreeId } = stabilizeClusterIds(prev, next);
    expect(stable.assignment.a).toBe(0);
    expect(stable.assignment.x).toBe(1);
    expect(nextFreeId).toBeGreaterThanOrEqual(2);
  });

  it("passes through when there is no previous result", () => {
    const next = result([{ id: 0, blockIds: ["a"] }]);
    const { result: stable } = stabilizeClusterIds(undefined, next);
    expect(stable).toBe(next);
  });
});

describe("StableClusterer", () => {
  it("keeps ids stable as data grows", () => {
    const clusterer = new StableClusterer(new LouvainClusterer());
    const first = clusterer.cluster(fixtureBlocks);
    const graphId = first.assignment.g1;

    const grown = [
      ...fixtureBlocks,
      { id: "g4", parentId: null, order: 0, type: "text" as const, content: "another graph note about links", props: { tags: ["graph", "pkm"] }, createdAt: 0, updatedAt: 0 },
    ];
    const second = clusterer.cluster(grown);
    // the graph community retains its original id
    expect(second.assignment.g1).toBe(graphId);
    expect(second.assignment.g4).toBe(graphId);
  });

  it("reset clears history", () => {
    const clusterer = new StableClusterer(new LouvainClusterer());
    clusterer.cluster(fixtureBlocks);
    clusterer.reset();
    expect(() => clusterer.cluster(fixtureBlocks)).not.toThrow();
  });
});
