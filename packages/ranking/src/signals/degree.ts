/**
 * SLICE (b) — degree centrality over the derived edge graph.
 * Owner: child subagent. Replace this stub with the real implementation.
 *
 * Signature is FROZEN for the integrator:
 *   degreeCentrality(graph: RankGraph, opts?: DegreeOptions): SignalScores
 */

import type { RankGraph } from "../graph.js";
import type { SignalScores } from "../types.js";

export interface DegreeOptions {
  /** sum edge weights instead of counting distinct neighbours. */
  weighted?: boolean;
  /** which direction(s) to count. Default "both". */
  mode?: "in" | "out" | "both";
}

export function degreeCentrality(graph: RankGraph, _opts: DegreeOptions = {}): SignalScores {
  void _opts;
  // STUB: zero degree everywhere. Child replaces with real (weighted) degree.
  const scores: SignalScores = new Map();
  for (const id of graph.nodes) scores.set(id, 0);
  return scores;
}
