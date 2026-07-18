import { describe, expect, it } from "vitest";
import type { ClusterResult, Membership } from "@atlas/contracts";
import { StableClusterer, stabilizeClusterIds } from "./stable.js";
import { LouvainClusterer } from "./louvain.js";
import { fixtureBlocks } from "./fixtures.js";

function result(
  clusters: Array<{ id: number; blockIds: string[] }>,
  memberships?: Membership[],
): ClusterResult {
  const assignment: Record<string, number> = {};
  for (const c of clusters) for (const b of c.blockIds) assignment[b] = c.id;
  return {
    method: "louvain",
    clusters: clusters.map((c) => ({ ...c, cohesion: 1 })),
    assignment,
    memberships,
    quality: 1,
  };
}

/** Set of block ids that share a stable cluster id in `r`. */
function clusterOf(r: ClusterResult, blockId: string): number {
  return r.assignment[blockId];
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

  it("seeds nextFreeId above the max id when there is no previous result", () => {
    const next = result([
      { id: 5, blockIds: ["a"] },
      { id: 2, blockIds: ["b"] },
    ]);
    const { nextFreeId } = stabilizeClusterIds(undefined, next);
    expect(nextFreeId).toBe(6);
  });

  it("respects a caller-supplied nextFreeId floor even with no previous", () => {
    const next = result([{ id: 0, blockIds: ["a"] }]);
    const { nextFreeId } = stabilizeClusterIds(undefined, next, 42);
    expect(nextFreeId).toBe(42);
  });

  it("handles an empty next partition", () => {
    const prev = result([{ id: 3, blockIds: ["a"] }]);
    const next = result([]);
    const { result: stable, nextFreeId } = stabilizeClusterIds(prev, next, 7);
    expect(stable.clusters).toEqual([]);
    expect(stable.assignment).toEqual({});
    expect(nextFreeId).toBe(7);
  });

  describe("splits", () => {
    it("gives the larger-overlap child the old id and a fresh id to the rest", () => {
      const prev = result([{ id: 0, blockIds: ["a", "b", "c", "d"] }]);
      // community splits: {a,b,c} clearly inherits, {d,+new} is a new community
      const next = result([
        { id: 7, blockIds: ["d", "x", "y"] },
        { id: 9, blockIds: ["a", "b", "c"] },
      ]);
      const { result: stable, nextFreeId } = stabilizeClusterIds(prev, next);
      expect(stable.assignment.a).toBe(0);
      expect(stable.assignment.b).toBe(0);
      expect(stable.assignment.c).toBe(0);
      // the split-off part is genuinely new
      const split = stable.assignment.d;
      expect(split).not.toBe(0);
      expect(split).toBeGreaterThanOrEqual(1);
      expect(nextFreeId).toBe(split + 1);
    });

    it("breaks an exact Jaccard tie by absolute overlap count", () => {
      // prev has one big community
      const prev = result([{ id: 0, blockIds: ["a", "b", "c", "d", "e", "f"] }]);
      // two children with equal Jaccard vs prev but different absolute overlap:
      //   child1 {a,b,c} + 3 new  -> inter 3, union 9 -> 1/3
      //   child2 {d,e}   + 1 new  -> inter 2, union 7 -> 2/7  (lower)
      // child1 has both higher Jaccard AND higher inter, so it must inherit.
      const next = result([
        { id: 1, blockIds: ["d", "e", "z"] },
        { id: 2, blockIds: ["a", "b", "c", "p", "q", "r"] },
      ]);
      const { result: stable } = stabilizeClusterIds(prev, next);
      expect(stable.assignment.a).toBe(0);
      expect(stable.assignment.d).not.toBe(0);
    });
  });

  describe("merges", () => {
    it("keeps one id for the merged cluster and retires the other", () => {
      const prev = result([
        { id: 0, blockIds: ["a", "b"] },
        { id: 1, blockIds: ["c", "d"] },
      ]);
      // both communities merge into one
      const next = result([{ id: 5, blockIds: ["a", "b", "c", "d"] }]);
      const { result: stable } = stabilizeClusterIds(prev, next);
      // tie in Jaccard (2/4 vs 2/4) and inter (2 vs 2) -> lowest prevId wins
      expect(stable.assignment.a).toBe(0);
      expect(stable.assignment.c).toBe(0);
      expect(stable.clusters).toHaveLength(1);
    });

    it("keeps the id of the community it overlaps most with when merge is lopsided", () => {
      const prev = result([
        { id: 0, blockIds: ["a"] },
        { id: 1, blockIds: ["b", "c", "d"] },
      ]);
      const next = result([{ id: 9, blockIds: ["a", "b", "c", "d"] }]);
      const { result: stable } = stabilizeClusterIds(prev, next);
      // cluster 1 overlaps more (3 vs 1), so the merged cluster keeps id 1
      expect(stable.assignment.b).toBe(1);
      expect(stable.assignment.a).toBe(1);
    });
  });

  describe("removed blocks / communities", () => {
    it("retires a removed community's id and does not recycle it for a new one", () => {
      const prev = result([
        { id: 0, blockIds: ["a", "b"] },
        { id: 1, blockIds: ["c", "d"] },
      ]);
      // community 1 disappears; a brand-new community appears
      const next = result([
        { id: 0, blockIds: ["a", "b"] },
        { id: 3, blockIds: ["x", "y"] },
      ]);
      const { result: stable } = stabilizeClusterIds(prev, next);
      expect(stable.assignment.a).toBe(0);
      // must NOT reuse retired id 1 for the unrelated new community
      expect(stable.assignment.x).not.toBe(1);
      expect(stable.assignment.x).toBeGreaterThanOrEqual(2);
    });

    it("keeps a shrinking community's id when some members are removed", () => {
      const prev = result([{ id: 4, blockIds: ["a", "b", "c", "d"] }]);
      const next = result([{ id: 0, blockIds: ["a", "b"] }]);
      const { result: stable } = stabilizeClusterIds(prev, next);
      expect(stable.assignment.a).toBe(4);
    });
  });

  describe("ties", () => {
    it("is deterministic and order-independent for symmetric overlaps", () => {
      const prev = result([
        { id: 0, blockIds: ["a", "b"] },
        { id: 1, blockIds: ["c", "d"] },
      ]);
      const nextA = result([
        { id: 0, blockIds: ["a", "b"] },
        { id: 1, blockIds: ["c", "d"] },
      ]);
      const nextB = result([
        { id: 1, blockIds: ["c", "d"] },
        { id: 0, blockIds: ["a", "b"] },
      ]);
      const ra = stabilizeClusterIds(prev, nextA).result.assignment;
      const rb = stabilizeClusterIds(prev, nextB).result.assignment;
      expect(ra).toEqual(rb);
      expect(ra.a).toBe(0);
      expect(ra.c).toBe(1);
    });
  });

  it("remaps hard assignment, cluster objects and soft memberships together", () => {
    const prev = result([
      { id: 0, blockIds: ["a", "b"] },
      { id: 1, blockIds: ["c", "d"] },
    ]);
    const next = result(
      [
        { id: 10, blockIds: ["c", "d"] },
        { id: 11, blockIds: ["a", "b"] },
      ],
      [
        { blockId: "a", clusterId: 11, weight: 0.9 },
        { blockId: "a", clusterId: 10, weight: 0.1 },
      ],
    );
    const { result: stable } = stabilizeClusterIds(prev, next);
    // assignment remapped
    expect(clusterOf(stable, "a")).toBe(0);
    expect(clusterOf(stable, "c")).toBe(1);
    // cluster objects carry the stable ids and stay sorted
    expect(stable.clusters.map((c) => c.id)).toEqual([0, 1]);
    // memberships remapped to the same stable ids
    const aMain = stable.memberships?.find((m) => m.blockId === "a" && m.weight === 0.9);
    const aSoft = stable.memberships?.find((m) => m.blockId === "a" && m.weight === 0.1);
    expect(aMain?.clusterId).toBe(0);
    expect(aSoft?.clusterId).toBe(1);
  });

  it("keeps fresh ids monotonic when fed its own returned nextFreeId", () => {
    const r0 = result([{ id: 0, blockIds: ["a", "b"] }]);
    const s0 = stabilizeClusterIds(undefined, r0);
    // add a new community
    const r1 = result([
      { id: 0, blockIds: ["a", "b"] },
      { id: 1, blockIds: ["x", "y"] },
    ]);
    const s1 = stabilizeClusterIds(s0.result, r1, s0.nextFreeId);
    const newId1 = s1.result.assignment.x;
    // that community vanishes and a different new one appears
    const r2 = result([
      { id: 0, blockIds: ["a", "b"] },
      { id: 1, blockIds: ["m", "n"] },
    ]);
    const s2 = stabilizeClusterIds(s1.result, r2, s1.nextFreeId);
    const newId2 = s2.result.assignment.m;
    expect(newId2).toBeGreaterThan(newId1);
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

  it("exposes the inner clusterer's method", () => {
    const inner = new LouvainClusterer();
    const clusterer = new StableClusterer(inner);
    expect(clusterer.method).toBe(inner.method);
  });

  it("is idempotent when re-clustering identical data", () => {
    const clusterer = new StableClusterer(new LouvainClusterer());
    const a = clusterer.cluster(fixtureBlocks);
    const b = clusterer.cluster(fixtureBlocks);
    expect(b.assignment).toEqual(a.assignment);
  });

  it("reset clears history", () => {
    const clusterer = new StableClusterer(new LouvainClusterer());
    clusterer.cluster(fixtureBlocks);
    clusterer.reset();
    expect(() => clusterer.cluster(fixtureBlocks)).not.toThrow();
  });

  it("reset lets fresh ids restart from zero", () => {
    const clusterer = new StableClusterer(new LouvainClusterer());
    clusterer.cluster(fixtureBlocks);
    clusterer.reset();
    const after = clusterer.cluster(fixtureBlocks);
    const ids = after.clusters.map((c) => c.id).sort((x, y) => x - y);
    expect(ids[0]).toBe(0);
  });
});
