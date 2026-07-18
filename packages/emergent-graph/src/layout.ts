/**
 * Deterministic 2D layout for emergent structure. Real renderers (react-force-
 * graph, 3d-force-graph) own their own physics; this gives the package a stable,
 * dependency-free, reproducible layout for hull geometry, the demo canvas and
 * tests. Nodes are grouped by cluster into angular sectors around the centre,
 * pushed outward by (inverse) rank so important nodes sit toward the middle.
 */

import type { EmergentGraphData } from "@atlas/contracts";
import type { LayoutOptions, NodePosition } from "./types.js";

/** Mulberry32 — tiny deterministic PRNG so jitter is reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Compute reproducible positions for every node in `data.nodeAttrs`. Grouped by
 * clusterId; each cluster gets an angular wedge, members ring around a cluster
 * centre, and higher-rank nodes are pulled toward the wedge centre.
 */
export function computeLayout(
  data: EmergentGraphData,
  opts: LayoutOptions = {},
): NodePosition[] {
  const width = opts.width ?? 1000;
  const height = opts.height ?? 1000;
  const rand = mulberry32(opts.seed ?? 1);

  const cx = width / 2;
  const cy = height / 2;
  const clusterRadius = Math.min(width, height) * 0.32;
  const memberRadius = Math.min(width, height) * 0.16;

  const attrs = Object.values(data.nodeAttrs);
  const byCluster = new Map<number, typeof attrs>();
  for (const a of attrs) {
    const arr = byCluster.get(a.clusterId) ?? [];
    arr.push(a);
    byCluster.set(a.clusterId, arr);
  }

  const clusterIds = [...byCluster.keys()].sort((a, b) => a - b);
  const positions: NodePosition[] = [];

  clusterIds.forEach((clusterId, ci) => {
    const members = byCluster.get(clusterId) ?? [];
    const wedge = clusterIds.length === 0 ? 0 : (2 * Math.PI * ci) / clusterIds.length;
    const clusterCx = cx + Math.cos(wedge) * clusterRadius * (clusterIds.length > 1 ? 1 : 0);
    const clusterCy = cy + Math.sin(wedge) * clusterRadius * (clusterIds.length > 1 ? 1 : 0);

    members
      .slice()
      .sort((a, b) => b.rank - a.rank)
      .forEach((m, mi) => {
        const angle = (2 * Math.PI * mi) / Math.max(1, members.length) + wedge;
        // higher rank -> closer to the cluster centre.
        const r = memberRadius * (1 - Math.min(1, Math.max(0, m.rank)) * 0.6);
        const jitter = (rand() - 0.5) * memberRadius * 0.15;
        positions.push({
          id: m.id,
          x: clusterCx + Math.cos(angle) * (r + jitter),
          y: clusterCy + Math.sin(angle) * (r + jitter),
        });
      });
  });

  return positions;
}

/** Convenience index for renderers: id -> position. */
export function positionMap(positions: NodePosition[]): Map<string, NodePosition> {
  return new Map(positions.map((p) => [p.id, p]));
}
