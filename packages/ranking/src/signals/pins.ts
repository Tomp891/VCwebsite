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

/** Coerce a prop value to a finite number, or undefined if not numeric. */
function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return undefined;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export function pinWeights(blocks: Block[], opts: PinOptions = {}): SignalScores {
  const prop = opts.prop ?? "pinned";
  const priorityProp = opts.priorityProp ?? "priority";

  const scores: SignalScores = new Map();
  for (const b of blocks) {
    let weight = 0;

    const pin = b.props[prop];
    if (pin === true) {
      weight = 1;
    } else {
      const numericPin = toFiniteNumber(pin);
      if (numericPin !== undefined) weight = numericPin;
    }

    const priority = toFiniteNumber(b.props[priorityProp]);
    if (priority !== undefined) weight += priority;

    if (weight < 0) weight = 0;
    scores.set(b.id, weight);
  }
  return scores;
}
