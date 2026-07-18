/**
 * (e) Soft / multi-membership.
 *
 * A hard partition assigns each block to one cluster; soft memberships express
 * how strongly a block also belongs to neighbouring clusters, derived from the
 * fraction of its incident edge weight that lands in each cluster.
 */

import type { BlockId, Membership } from "@atlas/contracts";
import { weightedDegree } from "./graph.js";
import type { WeightedGraph } from "./types.js";

/**
 * Compute soft memberships for every block. Each block's weights across clusters
 * sum to 1. Its assigned cluster always receives a share (a self-weight ensures
 * isolated nodes still belong fully to their own cluster).
 *
 * Only memberships at or above `minWeight` are returned.
 */
export function softMemberships(
  graph: WeightedGraph,
  assignment: Record<BlockId, number>,
  minWeight = 0.1,
  selfWeight = 1,
): Membership[] {
  const out: Membership[] = [];

  for (const node of graph.nodes) {
    const home = assignment[node];
    if (home === undefined) continue;

    const perCluster = new Map<number, number>();
    // self affinity keeps hard assignment dominant and handles degree-0 nodes.
    perCluster.set(home, selfWeight);

    const nbrs = graph.adj.get(node);
    if (nbrs) {
      for (const [other, w] of nbrs) {
        const c = assignment[other];
        if (c === undefined) continue;
        perCluster.set(c, (perCluster.get(c) ?? 0) + w);
      }
    }

    let total = 0;
    for (const w of perCluster.values()) total += w;
    if (total <= 0) continue;

    const sorted = [...perCluster.entries()].sort(
      (a, b) => b[1] - a[1] || a[0] - b[0],
    );
    for (const [clusterId, w] of sorted) {
      const weight = w / total;
      if (weight < minWeight && clusterId !== home) continue;
      out.push({ blockId: node, clusterId, weight });
    }
  }

  return out;
}

/** The most central member of a cluster (highest weighted degree), if any. */
export function centroidBlock(
  graph: WeightedGraph,
  members: BlockId[],
): BlockId | undefined {
  let best: BlockId | undefined;
  let bestDeg = -1;
  for (const id of members) {
    const deg = weightedDegree(graph, id);
    if (deg > bestDeg || (deg === bestDeg && best !== undefined && id < best)) {
      bestDeg = deg;
      best = id;
    }
  }
  return best;
}
