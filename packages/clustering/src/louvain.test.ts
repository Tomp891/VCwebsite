import { describe, expect, it } from "vitest";
import type { BlockId } from "@atlas/contracts";
import { addEdge, buildAdjacency, emptyGraph } from "./graph.js";
import { LouvainClusterer, louvain, toClusterResult } from "./louvain.js";
import { modularity } from "./quality.js";
import type { WeightedGraph } from "./types.js";
import { fixtureBlocks, MockEmbeddingIndex } from "./fixtures.js";

/** Build an undirected weighted graph from an explicit edge list. */
function graphOf(nodes: BlockId[], edges: Array<[BlockId, BlockId, number]>): WeightedGraph {
  const g = emptyGraph(nodes);
  for (const [a, b, w] of edges) addEdge(g, a, b, w);
  return g;
}

/** Group node ids by their assigned community label. */
function communities(assignment: Record<BlockId, number>): Map<number, BlockId[]> {
  const out = new Map<number, BlockId[]>();
  for (const [id, c] of Object.entries(assignment)) {
    const arr = out.get(c) ?? [];
    arr.push(id);
    out.set(c, arr);
  }
  return out;
}

/** Assignment where every node is its own singleton community (a trivial baseline). */
function singletons(nodes: BlockId[]): Record<BlockId, number> {
  const out: Record<BlockId, number> = {};
  nodes.forEach((id, i) => (out[id] = i));
  return out;
}

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

describe("louvain — structural correctness", () => {
  it("returns an empty assignment for an empty graph", () => {
    const g = graphOf([], []);
    expect(louvain(g)).toEqual({});
  });

  it("assigns each node to its own singleton when there are no edges", () => {
    const nodes = ["n0", "n1", "n2", "n3"];
    const g = graphOf(nodes, []);
    const assignment = louvain(g);
    const labels = nodes.map((n) => assignment[n]);
    expect(new Set(labels).size).toBe(nodes.length);
    // dense 0..K-1 labels in node order
    expect(labels).toEqual([0, 1, 2, 3]);
    // an edgeless partition has zero modularity
    expect(modularity(g, assignment)).toBe(0);
  });

  it("puts the two endpoints of a single edge in one community", () => {
    const g = graphOf(["x", "y"], [["x", "y", 1]]);
    const assignment = louvain(g);
    expect(assignment.x).toBe(assignment.y);
    // merged (Q=0) beats split (Q=-0.5)
    expect(modularity(g, assignment)).toBeGreaterThanOrEqual(
      modularity(g, singletons(["x", "y"])),
    );
  });

  it("keeps two disconnected cliques as two communities", () => {
    const nodes = ["a", "b", "c", "d", "e", "f"];
    const g = graphOf(nodes, [
      ["a", "b", 1],
      ["a", "c", 1],
      ["b", "c", 1],
      ["d", "e", 1],
      ["d", "f", 1],
      ["e", "f", 1],
    ]);
    const assignment = louvain(g);
    const groups = communities(assignment);
    expect(groups.size).toBe(2);
    expect(assignment.a).toBe(assignment.b);
    expect(assignment.b).toBe(assignment.c);
    expect(assignment.d).toBe(assignment.e);
    expect(assignment.e).toBe(assignment.f);
    expect(assignment.a).not.toBe(assignment.d);
    expect(modularity(g, assignment)).toBeCloseTo(0.5, 6);
  });

  it("recovers three planted cliques linked by weak bridges", () => {
    const clique = (p: string) => [`${p}0`, `${p}1`, `${p}2`];
    const nodes = [...clique("x"), ...clique("y"), ...clique("z")];
    const edges: Array<[BlockId, BlockId, number]> = [];
    for (const p of ["x", "y", "z"]) {
      edges.push([`${p}0`, `${p}1`, 1], [`${p}0`, `${p}2`, 1], [`${p}1`, `${p}2`, 1]);
    }
    // weak inter-clique bridges
    edges.push(["x0", "y0", 0.05], ["y0", "z0", 0.05]);
    const g = graphOf(nodes, edges);
    const assignment = louvain(g);
    for (const p of ["x", "y", "z"]) {
      const [a, b, c] = clique(p);
      expect(assignment[a]).toBe(assignment[b]);
      expect(assignment[b]).toBe(assignment[c]);
    }
    expect(assignment.x0).not.toBe(assignment.y0);
    expect(assignment.y0).not.toBe(assignment.z0);
    expect(communities(assignment).size).toBe(3);
  });

  it("respects edge weights over topology (strong bridge wins)", () => {
    // Two cliques A={a*} and B={b*}. The bridge node n0 links weakly to A and
    // strongly to B, so it must join B.
    const nodes = ["a0", "a1", "a2", "b0", "b1", "b2", "n0"];
    const g = graphOf(nodes, [
      ["a0", "a1", 1],
      ["a0", "a2", 1],
      ["a1", "a2", 1],
      ["b0", "b1", 1],
      ["b0", "b2", 1],
      ["b1", "b2", 1],
      ["a0", "n0", 0.1],
      ["b0", "n0", 1],
    ]);
    const assignment = louvain(g);
    expect(assignment.n0).toBe(assignment.b0);
    expect(assignment.n0).not.toBe(assignment.a0);
  });
});

describe("louvain — determinism & quality guarantees", () => {
  it("is byte-for-byte deterministic across repeated runs", () => {
    const graph = buildAdjacency(fixtureBlocks, new MockEmbeddingIndex(fixtureBlocks));
    const a = louvain(graph);
    const b = louvain(graph);
    const c = louvain(graph);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });

  it("produces dense, 0-based community labels", () => {
    const graph = buildAdjacency(fixtureBlocks);
    const assignment = louvain(graph);
    const labels = [...new Set(Object.values(assignment))].sort((x, y) => x - y);
    expect(labels[0]).toBe(0);
    expect(labels).toEqual(labels.map((_, i) => i));
  });

  it("never scores worse than the all-singletons partition", () => {
    const graph = buildAdjacency(fixtureBlocks, new MockEmbeddingIndex(fixtureBlocks));
    const assignment = louvain(graph);
    const q = modularity(graph, assignment);
    expect(q).toBeGreaterThanOrEqual(modularity(graph, singletons(graph.nodes)) - 1e-9);
    expect(q).toBeGreaterThan(0);
  });

  it("breaks ties toward the lowest community index", () => {
    // Symmetric bridge: n0 wired identically into {a*} and {b*}. With equal gain,
    // deterministic tie-breaking must place it with the lower-indexed community.
    const nodes = ["a0", "a1", "a2", "n0", "b0", "b1", "b2"];
    const g = graphOf(nodes, [
      ["a0", "a1", 1],
      ["a0", "a2", 1],
      ["a1", "a2", 1],
      ["b0", "b1", 1],
      ["b0", "b2", 1],
      ["b1", "b2", 1],
      ["a0", "n0", 0.5],
      ["b0", "n0", 0.5],
    ]);
    const first = louvain(g);
    const second = louvain(g);
    expect(first).toEqual(second);
    // n0 joins exactly one of the two symmetric cliques
    const joinsA = first.n0 === first.a0;
    const joinsB = first.n0 === first.b0;
    expect(joinsA !== joinsB).toBe(true);
  });
});

describe("toClusterResult", () => {
  it("mirrors the hard assignment into sorted clusters and matching quality", () => {
    const graph = buildAdjacency(fixtureBlocks);
    const assignment = louvain(graph);
    const result = toClusterResult(graph, assignment, "louvain");

    expect(result.method).toBe("louvain");
    expect(result.assignment).toEqual(assignment);
    expect(result.quality).toBeCloseTo(modularity(graph, assignment), 12);

    // clusters sorted by id, ascending
    const ids = result.clusters.map((c) => c.id);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));

    // every block appears in exactly one cluster
    const covered = result.clusters.flatMap((c) => c.blockIds).sort();
    expect(covered).toEqual(graph.nodes.slice().sort());

    // each cluster's members all share its assignment id
    for (const cluster of result.clusters) {
      for (const id of cluster.blockIds) expect(assignment[id]).toBe(cluster.id);
    }
  });

  it("handles an edgeless graph as singleton clusters", () => {
    const nodes = ["p", "q", "r"];
    const g = graphOf(nodes, []);
    const assignment = louvain(g);
    const result = toClusterResult(g, assignment, "louvain");
    expect(result.clusters).toHaveLength(3);
    expect(result.quality).toBe(0);
  });
});
