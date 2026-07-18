/**
 * SLICE (c) — recency decay from `updatedAt`.
 * Owner: child subagent. Replace this stub with the real exponential decay.
 *
 * Signature is FROZEN for the integrator:
 *   recencyDecay(blocks: Block[], opts?: RecencyOptions): SignalScores
 */

import type { Block } from "@atlas/contracts";
import type { SignalScores } from "../types.js";

export interface RecencyOptions {
  /** reference "now"; defaults to max(updatedAt) for determinism. */
  now?: number;
  /** half-life in ms; score halves every half-life of age. */
  halfLifeMs?: number;
}

export function recencyDecay(blocks: Block[], _opts: RecencyOptions = {}): SignalScores {
  void _opts;
  // STUB: neutral 0. Child replaces with exp decay of (now - updatedAt).
  const scores: SignalScores = new Map();
  for (const b of blocks) scores.set(b.id, 0);
  return scores;
}
