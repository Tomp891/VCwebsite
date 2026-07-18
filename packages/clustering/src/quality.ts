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
 *
 *   Q = 1/(2m) · Σ_ij [ A_ij - k_i·k_j / (2m) ] · δ(c_i, c_j)
 *     = Σ_c [ l_c / m - (d_c / 2m)² ]
 *
 * where m is the total edge weight, l_c the weight of edges inside community c,
 * and d_c the summed weighted degree of its members. Returns 0 for an empty or
 * edgeless graph (Q is undefined when there are no edges).
 */
export function modularity(
  graph: WeightedGraph,
  assignment: Record<BlockId, number>,
): number {
  const m = graph.totalWeight;
  if (!Number.isFinite(m) || m <= 0) return 0;
  const twoM = 2 * m;

  // inWeight accumulates each internal edge twice (once per endpoint), which is
  // exactly 2·l_c, so inWeight/2m reduces to l_c/m below.
  const inWeight = new Map<number, number>();
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
 * edge weight that stays inside the cluster (1 = perfectly isolated community,
 * 0 = an edgeless cluster or one whose members only link outward).
 *
 * Duplicate member ids are ignored so the ratio is not skewed by repeats.
 */
export function clusterCohesion(graph: WeightedGraph, members: BlockId[]): number {
  const set = new Set(members);
  let internal = 0;
  let incident = 0;
  for (const node of set) {
    const nbrs = graph.adj.get(node);
    if (!nbrs) continue;
    for (const [other, w] of nbrs) {
      incident += w;
      if (set.has(other)) internal += w;
    }
  }
  if (incident <= 0) return 0;
  return internal / incident;
}
