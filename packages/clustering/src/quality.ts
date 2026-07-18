/**
 * (e) Quality metrics — modularity of a partition and per-cluster cohesion.
 *
 * These are pure functions over a WeightedGraph + a hard assignment, used both
 * to score a ClusterResult and to drive Louvain's optimisation.
 */

import type { BlockId } from "@atlas/contracts";
import { weightedDegree } from "./graph.js";
import type { WeightedGraph } from "./types.js";

/**
 * Newman modularity Q in [-0.5, 1] (typically 0..1 for good partitions).
 * Q = 1/(2m) * Σ_ij [ A_ij - k_i k_j / (2m) ] · δ(c_i, c_j)
 */
export function modularity(
  graph: WeightedGraph,
  assignment: Record<BlockId, number>,
): number {
  const m = graph.totalWeight;
  if (m <= 0) return 0;
  const twoM = 2 * m;

  const inWeight = new Map<number, number>(); // counts each internal edge twice
  const degSum = new Map<number, number>();

  for (const node of graph.nodes) {
    const c = assignment[node];
    if (c === undefined) continue;
    degSum.set(c, (degSum.get(c) ?? 0) + weightedDegree(graph, node));
    const nbrs = graph.adj.get(node);
    if (!nbrs) continue;
    for (const [other, w] of nbrs) {
      if (assignment[other] === c) inWeight.set(c, (inWeight.get(c) ?? 0) + w);
    }
  }

  let q = 0;
  for (const c of degSum.keys()) {
    const inside = inWeight.get(c) ?? 0;
    const deg = degSum.get(c) ?? 0;
    q += inside / twoM - (deg / twoM) ** 2;
  }
  return q;
}

/**
 * Cohesion of a single cluster in [0,1]: the fraction of its members' incident
 * edge weight that stays inside the cluster (1 = perfectly isolated community).
 */
export function clusterCohesion(graph: WeightedGraph, members: BlockId[]): number {
  const set = new Set(members);
  let internal = 0;
  let incident = 0;
  for (const node of members) {
    const nbrs = graph.adj.get(node);
    if (!nbrs) continue;
    for (const [other, w] of nbrs) {
      incident += w;
      if (set.has(other)) internal += w;
    }
  }
  if (incident === 0) return 0;
  return internal / incident;
}
