/**
 * Confidence thresholding — the guardrail that keeps autotagging SUGGEST-ONLY.
 *
 * NOTHING in this file mutates a Block or auto-applies a tag. It is a pure,
 * deterministic filter over already-scored candidates: low-confidence entries
 * are dropped and the survivors are sorted and capped for human review. This is
 * the single enforcement point for "suggest-only, never auto-apply".
 *
 * Subagent (c) owns this file.
 */

/** Minimum confidence for a suggestion to surface. */
export const DEFAULT_TAG_THRESHOLD = 0.3;

/** Never overwhelm review UI: cap suggestions per block. */
export const MAX_SUGGESTIONS = 5;

export interface ThresholdOptions {
  minConfidence?: number;
  maxSuggestions?: number;
}

/**
 * Clamp any raw score into the 0..1 confidence range. Non-finite inputs
 * (`NaN`, `±Infinity`) collapse to a defined value so downstream sorting and
 * comparisons stay deterministic: `NaN` -> 0, `-Infinity` -> 0, `+Infinity` -> 1.
 */
export function clampConfidence(value: number): number {
  if (Number.isNaN(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

/**
 * Resolve `maxSuggestions` into a safe, non-negative cap. Fractional values are
 * floored and non-finite/negative values fall back to no cap being exceeded.
 */
function resolveCap(max: number | undefined): number {
  if (max === undefined || Number.isNaN(max)) return MAX_SUGGESTIONS;
  if (max <= 0) return 0;
  if (!Number.isFinite(max)) return Number.MAX_SAFE_INTEGER;
  return Math.floor(max);
}

/**
 * Filter to items at/above `minConfidence`, sort by confidence (desc) and cap
 * to `maxSuggestions`.
 *
 * PURE: returns a brand-new array and never mutates the input array or its
 * elements — no Block is touched and no tag is applied. Items whose confidence
 * is not a finite number are dropped (they can never meet the threshold), which
 * also keeps the sort deterministic. Ties preserve the input order (stable sort).
 */
export function applyThreshold<T extends { confidence: number }>(
  items: T[],
  opts: ThresholdOptions = {},
): T[] {
  const rawMin = opts.minConfidence ?? DEFAULT_TAG_THRESHOLD;
  const min = Number.isNaN(rawMin) ? DEFAULT_TAG_THRESHOLD : rawMin;
  const cap = resolveCap(opts.maxSuggestions);
  return items
    .filter((it) => Number.isFinite(it.confidence) && it.confidence >= min)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, cap);
}
