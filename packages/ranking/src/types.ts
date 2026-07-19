/**
 * Internal types shared across the ranking signals.
 *
 * Each ranking "signal" (pagerank, degree, recency, pin) is a pure function that
 * maps blocks/graph -> a raw score per block. The blender then normalizes and
 * combines them into the frozen `RankScore` contract.
 */

import type { BlockId, RankSignal } from "@atlas/contracts";

/** Raw (un-normalized) per-block score produced by a single signal. */
export type SignalScores = Map<BlockId, number>;

/** Tunable blend weights per signal. Missing signals default to 0. */
export type SignalWeights = Partial<Record<RankSignal, number>>;

/** Default blend weights — pagerank dominates, pins can boost, recency nudges. */
export const DEFAULT_WEIGHTS: Required<Record<RankSignal, number>> = {
  pagerank: 0.5,
  degree: 0.2,
  recency: 0.15,
  pin: 0.15,
};
