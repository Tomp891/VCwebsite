import { describe, expect, it } from "vitest";
import type { BlockId } from "@atlas/contracts";
import { addEdge, emptyGraph } from "./graph.js";
import { clusterCohesion, modularity } from "./quality.js";
import { centroidBlock, softMemberships } from "./membership.js";

/** Two triangles joined by a single weak bridge edge (c–d, weight 0.1). */
function twoTriangles() {
  const g = emptyGraph(["a", "b", "c", "d", "e", "f"]);
  for (const [x, y] of [["a", "b"], ["b", "c"], ["a", "c"]] as const) addEdge(g, x, y, 1);
  for (const [x, y] of [["d", "e"], ["e", "f"], ["d", "f"]] as const) addEdge(g, x, y, 1);
  addEdge(g, "c", "d", 0.1);
  return g;
}

const NATURAL: Record<BlockId, number> = { a: 0, b: 0, c: 0, d: 1, e: 1, f: 1 };

describe("modularity", () => {
  it("is high for the natural partition and low for a random one", () => {
    const g = twoTriangles();
    const bad = { a: 0, b: 1, c: 0, d: 1, e: 0, f: 1 };
    expect(modularity(g, NATURAL)).toBeGreaterThan(modularity(g, bad));
    expect(modularity(g, NATURAL)).toBeGreaterThan(0.3);
  });

  it("matches the closed-form value on the two-triangles fixture", () => {
    // m = 6.1; each community: l_c = 3, d_c = 6.1.
    // Q = 2·(3/6.1 - (6.1/12.2)²) = 2·(0.491803 - 0.25) = 0.483607
    expect(modularity(twoTriangles(), NATURAL)).toBeCloseTo(0.483607, 5);
  });

  it("is invariant to relabelling the community ids", () => {
    const g = twoTriangles();
    const relabelled = { a: 7, b: 7, c: 7, d: 2, e: 2, f: 2 };
    expect(modularity(g, relabelled)).toBeCloseTo(modularity(g, NATURAL), 12);
  });

  it("is negative when every node is placed in its own singleton", () => {
    const g = twoTriangles();
    const singletons = { a: 0, b: 1, c: 2, d: 3, e: 4, f: 5 };
    // no internal edges -> Q = -Σ (d_c/2m)² < 0
    expect(modularity(g, singletons)).toBeLessThan(0);
  });

  it("is 0 when all nodes are in one community (single cluster)", () => {
    const g = twoTriangles();
    const one = { a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 };
    // l = m, d = 2m -> Q = m/m - (2m/2m)² = 1 - 1 = 0
    expect(modularity(g, one)).toBeCloseTo(0, 12);
  });

  it("returns 0 for an edgeless graph", () => {
    expect(modularity(emptyGraph(["a", "b"]), { a: 0, b: 1 })).toBe(0);
  });

  it("returns 0 for an empty graph", () => {
    expect(modularity(emptyGraph([]), {})).toBe(0);
  });

  it("ignores nodes missing from the assignment", () => {
    const g = twoTriangles();
    const partial = { a: 0, b: 0, c: 0, d: 1, e: 1 }; // f omitted
    expect(Number.isFinite(modularity(g, partial))).toBe(true);
  });

  it("respects edge weights (heavier bridge lowers separation)", () => {
    const light = twoTriangles();
    const heavy = emptyGraph(["a", "b", "c", "d", "e", "f"]);
    for (const [x, y] of [["a", "b"], ["b", "c"], ["a", "c"]] as const) addEdge(heavy, x, y, 1);
    for (const [x, y] of [["d", "e"], ["e", "f"], ["d", "f"]] as const) addEdge(heavy, x, y, 1);
    addEdge(heavy, "c", "d", 3);
    expect(modularity(heavy, NATURAL)).toBeLessThan(modularity(light, NATURAL));
  });
});

describe("clusterCohesion", () => {
  it("is 1 for a fully-internal cluster and <1 with boundary edges", () => {
    const g = twoTriangles();
    expect(clusterCohesion(g, ["a", "b", "c", "d", "e", "f"])).toBe(1);
    expect(clusterCohesion(g, ["a", "b", "c"])).toBeLessThan(1);
    expect(clusterCohesion(g, ["a", "b", "c"])).toBeGreaterThan(0.8);
  });

  it("computes the exact boundary fraction", () => {
    // {a,b,c}: internal weight counted twice = 6, incident = 6 + bridge 0.1 = 6.1
    expect(clusterCohesion(twoTriangles(), ["a", "b", "c"])).toBeCloseTo(6 / 6.1, 12);
  });

  it("is 0 for an edgeless / isolated cluster", () => {
    expect(clusterCohesion(emptyGraph(["a", "b"]), ["a", "b"])).toBe(0);
    expect(clusterCohesion(twoTriangles(), [])).toBe(0);
  });

  it("is 0 for a boundary-only node with no internal edges", () => {
    // just node c on its own: its only edges leave the singleton cluster
    expect(clusterCohesion(twoTriangles(), ["c"])).toBe(0);
  });

  it("ignores duplicate member ids", () => {
    const g = twoTriangles();
    expect(clusterCohesion(g, ["a", "b", "c", "a", "b"])).toBeCloseTo(
      clusterCohesion(g, ["a", "b", "c"]),
      12,
    );
  });
});

describe("softMemberships", () => {
  it("gives a boundary node partial membership in the neighbouring cluster", () => {
    const g = twoTriangles();
    const mem = softMemberships(g, NATURAL, 0.01);
    const cMems = mem.filter((m) => m.blockId === "c");
    const clusters = new Set(cMems.map((m) => m.clusterId));
    expect(clusters.has(0)).toBe(true);
    expect(clusters.has(1)).toBe(true);
    const home = cMems.find((m) => m.clusterId === 0)!;
    const other = cMems.find((m) => m.clusterId === 1)!;
    expect(home.weight).toBeGreaterThan(other.weight);
  });

  it("weights per block sum to ~1", () => {
    const g = twoTriangles();
    const mem = softMemberships(g, NATURAL, 0);
    for (const node of g.nodes) {
      const total = mem
        .filter((m) => m.blockId === node)
        .reduce((s, m) => s + m.weight, 0);
      expect(total).toBeCloseTo(1, 6);
    }
  });

  it("keeps the home cluster even when its weight is below the threshold", () => {
    const g = twoTriangles();
    // a very high threshold would drop everything but home must survive
    const mem = softMemberships(g, NATURAL, 0.99);
    for (const node of g.nodes) {
      const homeMem = mem.find((m) => m.blockId === node && m.clusterId === NATURAL[node]);
      expect(homeMem).toBeDefined();
    }
  });

  it("gives an isolated node full membership in its own cluster", () => {
    const g = emptyGraph(["x", "y"]);
    const mem = softMemberships(g, { x: 0, y: 1 });
    const xMems = mem.filter((m) => m.blockId === "x");
    expect(xMems).toHaveLength(1);
    expect(xMems[0]).toEqual({ blockId: "x", clusterId: 0, weight: 1 });
  });

  it("filters neighbour clusters below the threshold but keeps them above it", () => {
    const g = twoTriangles();
    const strict = softMemberships(g, NATURAL, 0.5).filter((m) => m.blockId === "c");
    // c's neighbour-cluster share (~0.05) is well below 0.5, so only home remains
    expect(strict.map((m) => m.clusterId)).toEqual([0]);
  });

  it("clamps an out-of-range threshold instead of dropping the home cluster", () => {
    const g = twoTriangles();
    const mem = softMemberships(g, NATURAL, 5); // clamped to 1
    expect(mem.filter((m) => m.blockId === "a")).toHaveLength(1);
  });

  it("skips nodes that are absent from the assignment", () => {
    const g = twoTriangles();
    const partial: Record<BlockId, number> = { a: 0, b: 0, c: 0 };
    const mem = softMemberships(g, partial, 0);
    expect(mem.every((m) => ["a", "b", "c"].includes(m.blockId))).toBe(true);
  });

  it("is deterministic and orders memberships by descending weight", () => {
    const g = twoTriangles();
    const first = softMemberships(g, NATURAL, 0);
    const second = softMemberships(g, NATURAL, 0);
    expect(first).toEqual(second);
    const cMems = first.filter((m) => m.blockId === "c");
    for (let i = 1; i < cMems.length; i++) {
      expect(cMems[i - 1].weight).toBeGreaterThanOrEqual(cMems[i].weight);
    }
  });
});

describe("centroidBlock", () => {
  it("picks the highest-degree member", () => {
    const g = emptyGraph(["a", "b", "c"]);
    addEdge(g, "a", "b", 1);
    addEdge(g, "a", "c", 1);
    expect(centroidBlock(g, ["a", "b", "c"])).toBe("a");
  });

  it("accounts for edge weights, not just edge count", () => {
    const g = emptyGraph(["a", "b", "c"]);
    addEdge(g, "a", "b", 1);
    addEdge(g, "b", "c", 5); // b has the largest weighted degree
    expect(centroidBlock(g, ["a", "b", "c"])).toBe("b");
  });

  it("breaks ties by the smallest id and is deterministic", () => {
    const g = emptyGraph(["b", "a", "c"]); // insertion order differs from sort order
    expect(centroidBlock(g, ["b", "a", "c"])).toBe("a");
  });

  it("returns undefined for an empty member list", () => {
    expect(centroidBlock(twoTriangles(), [])).toBeUndefined();
  });

  it("returns a member even when the cluster is edgeless", () => {
    const g = emptyGraph(["a", "b"]);
    expect(centroidBlock(g, ["b", "a"])).toBe("a");
  });
});
