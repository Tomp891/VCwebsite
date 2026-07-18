/**
 * SLICE (e) — blend + normalize signals into the frozen `RankScore` contract.
 * Owner: child subagent. Replace this stub with the real min-max + weighting.
 *
 * Signatures are FROZEN for the integrator:
 *   normalize01(scores: SignalScores): SignalScores
 *   blend(signals, weights?): RankScore[]
 */

import type { BlockId, RankScore, RankSignal } from "@atlas/contracts";
import type { SignalScores, SignalWeights } from "./types.js";
import { DEFAULT_WEIGHTS } from "./types.js";

/** Min-max normalize raw scores into 0..1 (flat input -> all zeros). */
export function normalize01(scores: SignalScores): SignalScores {
  const out: SignalScores = new Map();
  const values = [...scores.values()];
  if (values.length === 0) return out;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  for (const [id, v] of scores) {
    out.set(id, span > 0 ? (v - min) / span : 0);
  }
  return out;
}

/**
 * Blend per-signal normalized scores into final `RankScore[]`.
 * Each signal is normalized to 0..1, multiplied by its weight, summed, then the
 * final blended score is normalized to 0..1. `breakdown` holds the already
 * weighted per-signal contribution (so the parts sum to the pre-normalization
 * total) for "why is this node big?" tooltips.
 */
export function blend(
  signals: Partial<Record<RankSignal, SignalScores>>,
  weights: SignalWeights = {},
): RankScore[] {
  const w = { ...DEFAULT_WEIGHTS, ...weights };

  // Union of all block ids across signals, preserving first-seen order.
  const ids: BlockId[] = [];
  const seen = new Set<BlockId>();
  for (const scores of Object.values(signals)) {
    if (!scores) continue;
    for (const id of scores.keys()) {
      if (!seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    }
  }

  const normalized: Partial<Record<RankSignal, SignalScores>> = {};
  for (const [sig, scores] of Object.entries(signals)) {
    if (scores) normalized[sig as RankSignal] = normalize01(scores);
  }

  const totals = new Map<BlockId, number>();
  const breakdowns = new Map<BlockId, Partial<Record<RankSignal, number>>>();
  for (const id of ids) {
    let total = 0;
    const breakdown: Partial<Record<RankSignal, number>> = {};
    for (const sig of Object.keys(normalized) as RankSignal[]) {
      const weight = w[sig] ?? 0;
      if (weight === 0) continue;
      const contribution = (normalized[sig]!.get(id) ?? 0) * weight;
      breakdown[sig] = contribution;
      total += contribution;
    }
    totals.set(id, total);
    breakdowns.set(id, breakdown);
  }

  const finalScores = normalize01(totals);
  return ids.map((id) => ({
    blockId: id,
    score: finalScores.get(id) ?? 0,
    breakdown: breakdowns.get(id) ?? {},
  }));
}
