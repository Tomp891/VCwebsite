/**
 * SLICE (a) — PageRank / eigenvector centrality over the derived edge graph.
 * Owner: child subagent. Replace this stub with the real power-iteration.
 *
 * Signature is FROZEN for the integrator:
 *   pagerank(graph: RankGraph, opts?: PageRankOptions): SignalScores
 */

import type { BlockId } from "@atlas/contracts";

import type { RankGraph, WeightedEdge } from "../graph.js";
import type { SignalScores } from "../types.js";

export interface PageRankOptions {
  /** teleport probability complement; typical 0.85. */
  damping?: number;
  maxIterations?: number;
  /** L1 convergence tolerance. */
  tolerance?: number;
}

export function pagerank(graph: RankGraph, opts: PageRankOptions = {}): SignalScores {
  const { damping = 0.85, maxIterations = 100, tolerance = 1e-6 } = opts;

  const nodes = graph.nodes;
  const n = nodes.length;
  const scores: SignalScores = new Map();
  if (n === 0) return scores;
  if (n === 1) {
    scores.set(nodes[0], 1);
    return scores;
  }

  // Precompute, per node (in graph.nodes order), the outgoing edges and the
  // total outgoing weight used to normalize rank distribution. Nodes with a
  // non-positive out-weight sum are "dangling" and redistribute uniformly.
  const outSums: number[] = new Array(n);
  const outLists: WeightedEdge[][] = new Array(n);
  for (let i = 0; i < n; i++) {
    const list = graph.outEdges.get(nodes[i]) ?? [];
    outLists[i] = list;
    let sum = 0;
    for (const e of list) {
      if (e.weight > 0) sum += e.weight;
    }
    outSums[i] = sum;
  }

  // Map node id -> index for scatter of rank into the next vector.
  const index = new Map<BlockId, number>();
  for (let i = 0; i < n; i++) index.set(nodes[i], i);

  const uniform = 1 / n;
  let rank: number[] = new Array(n).fill(uniform);

  for (let iter = 0; iter < maxIterations; iter++) {
    const next = new Array<number>(n).fill(0);

    // Rank mass from dangling nodes is redistributed uniformly to everyone.
    let danglingMass = 0;
    for (let i = 0; i < n; i++) {
      if (outSums[i] <= 0) danglingMass += rank[i];
    }

    const base = (1 - damping) / n + (damping * danglingMass) / n;
    for (let i = 0; i < n; i++) next[i] = base;

    for (let i = 0; i < n; i++) {
      const sum = outSums[i];
      if (sum <= 0) continue;
      const share = (damping * rank[i]) / sum;
      for (const e of outLists[i]) {
        if (e.weight <= 0) continue;
        const j = index.get(e.to);
        if (j === undefined) continue;
        next[j] += share * e.weight;
      }
    }

    let diff = 0;
    for (let i = 0; i < n; i++) diff += Math.abs(next[i] - rank[i]);
    rank = next;
    if (diff < tolerance) break;
  }

  for (let i = 0; i < n; i++) scores.set(nodes[i], rank[i]);
  return scores;
}
