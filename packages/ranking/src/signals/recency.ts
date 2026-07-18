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

const DAY_MS = 86_400_000;
const DEFAULT_HALF_LIFE_MS = 7 * DAY_MS;

export function recencyDecay(blocks: Block[], opts: RecencyOptions = {}): SignalScores {
  const scores: SignalScores = new Map();
  if (blocks.length === 0) return scores;

  const now = opts.now ?? Math.max(...blocks.map((b) => b.updatedAt));
  const halfLifeMs = opts.halfLifeMs ?? DEFAULT_HALF_LIFE_MS;

  for (const b of blocks) {
    const age = Math.max(0, now - b.updatedAt);
    scores.set(b.id, Math.pow(0.5, age / halfLifeMs));
  }
  return scores;
}
