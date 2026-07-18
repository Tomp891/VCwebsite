import { describe, expect, it } from "vitest";
import { addEdge, emptyGraph } from "./graph.js";
import { clusterCohesion, modularity } from "./quality.js";
import { centroidBlock, softMemberships } from "./membership.js";

/** Two triangles joined by a single weak bridge edge. */
function twoTriangles() {
  const g = emptyGraph(["a", "b", "c", "d", "e", "f"]);
  for (const [x, y] of [["a", "b"], ["b", "c"], ["a", "c"]] as const) addEdge(g, x, y, 1);
  for (const [x, y] of [["d", "e"], ["e", "f"], ["d", "f"]] as const) addEdge(g, x, y, 1);
  addEdge(g, "c", "d", 0.1);
  return g;
}

describe("modularity", () => {
  it("is high for the natural partition and low for a random one", () => {
    const g = twoTriangles();
    const good = { a: 0, b: 0, c: 0, d: 1, e: 1, f: 1 };
    const bad = { a: 0, b: 1, c: 0, d: 1, e: 0, f: 1 };
    expect(modularity(g, good)).toBeGreaterThan(modularity(g, bad));
    expect(modularity(g, good)).toBeGreaterThan(0.3);
  });

  it("returns 0 for an edgeless graph", () => {
    expect(modularity(emptyGraph(["a", "b"]), { a: 0, b: 1 })).toBe(0);
  });
});

describe("clusterCohesion", () => {
  it("is 1 for a fully-internal cluster and <1 with boundary edges", () => {
    const g = twoTriangles();
    expect(clusterCohesion(g, ["a", "b", "c", "d", "e", "f"])).toBe(1);
    expect(clusterCohesion(g, ["a", "b", "c"])).toBeLessThan(1);
    expect(clusterCohesion(g, ["a", "b", "c"])).toBeGreaterThan(0.8);
  });
});

describe("softMemberships", () => {
  it("gives a boundary node partial membership in the neighbouring cluster", () => {
    const g = twoTriangles();
    const assignment = { a: 0, b: 0, c: 0, d: 1, e: 1, f: 1 };
    const mem = softMemberships(g, assignment, 0.01);
    const cMems = mem.filter((m) => m.blockId === "c");
    const clusters = new Set(cMems.map((m) => m.clusterId));
    expect(clusters.has(0)).toBe(true);
    expect(clusters.has(1)).toBe(true);
    // home cluster dominates
    const home = cMems.find((m) => m.clusterId === 0)!;
    const other = cMems.find((m) => m.clusterId === 1)!;
    expect(home.weight).toBeGreaterThan(other.weight);
  });

  it("weights per block sum to ~1", () => {
    const g = twoTriangles();
    const assignment = { a: 0, b: 0, c: 0, d: 1, e: 1, f: 1 };
    const mem = softMemberships(g, assignment, 0);
    const total = mem.filter((m) => m.blockId === "a").reduce((s, m) => s + m.weight, 0);
    expect(total).toBeCloseTo(1, 6);
  });
});

describe("centroidBlock", () => {
  it("picks the highest-degree member", () => {
    const g = emptyGraph(["a", "b", "c"]);
    addEdge(g, "a", "b", 1);
    addEdge(g, "a", "c", 1);
    expect(centroidBlock(g, ["a", "b", "c"])).toBe("a");
  });
});
