/**
 * SLICE (b) — degree centrality over the derived edge graph.
 * Owner: child subagent. Replace this stub with the real implementation.
 *
 * Signature is FROZEN for the integrator:
 *   degreeCentrality(graph: RankGraph, opts?: DegreeOptions): SignalScores
 */

import type { BlockId } from "@atlas/contracts";
import type { RankGraph } from "../graph.js";
import type { SignalScores } from "../types.js";

export interface DegreeOptions {
  /** sum edge weights instead of counting distinct neighbours. */
  weighted?: boolean;
  /** which direction(s) to count. Default "both". */
  mode?: "in" | "out" | "both";
}

export function degreeCentrality(graph: RankGraph, opts: DegreeOptions = {}): SignalScores {
  const { weighted = false, mode = "both" } = opts;

  const scores: SignalScores = new Map();
  for (const id of graph.nodes) scores.set(id, 0);

  const accumulate = (id: BlockId, edges: readonly { weight: number }[]): void => {
    if (scores.get(id) === undefined) return;
    let sum = 0;
    for (const e of edges) sum += weighted ? e.weight : 1;
    scores.set(id, (scores.get(id) ?? 0) + sum);
  };

  for (const id of graph.nodes) {
    if (mode === "out" || mode === "both") accumulate(id, graph.outEdges.get(id) ?? []);
    if (mode === "in" || mode === "both") accumulate(id, graph.inEdges.get(id) ?? []);
  }

  return scores;
}
