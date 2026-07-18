/**
 * SLICE (d) — manual pin weighting (props-based).
 * Owner: child subagent. Replace this stub with the real prop parsing.
 *
 * Signature is FROZEN for the integrator:
 *   pinWeights(blocks: Block[], opts?: PinOptions): SignalScores
 */

import type { Block } from "@atlas/contracts";
import type { SignalScores } from "../types.js";

export interface PinOptions {
  /** prop key holding the pin flag/weight. Default "pinned". */
  prop?: string;
  /** prop key holding an explicit numeric priority. Default "priority". */
  priorityProp?: string;
}

export function pinWeights(blocks: Block[], _opts: PinOptions = {}): SignalScores {
  void _opts;
  // STUB: nothing pinned. Child replaces with props-based pin/priority parsing.
  const scores: SignalScores = new Map();
  for (const b of blocks) scores.set(b.id, 0);
  return scores;
}
