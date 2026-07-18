/**
 * Confidence thresholding — the guardrail that keeps autotagging SUGGEST-ONLY.
 * Nothing here mutates a block; low-confidence candidates are simply dropped and
 * the survivors are capped and sorted for review.
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
 * Filter to items at/above `minConfidence`, sort by confidence (desc) and cap
 * to `maxSuggestions`. Pure — returns a new array, never mutates inputs. This
 * is the enforcement point for "suggest-only, never auto-apply".
 */
export function applyThreshold<T extends { confidence: number }>(
  items: T[],
  opts: ThresholdOptions = {},
): T[] {
  const min = opts.minConfidence ?? DEFAULT_TAG_THRESHOLD;
  const max = opts.maxSuggestions ?? MAX_SUGGESTIONS;
  return items
    .filter((it) => it.confidence >= min)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, Math.max(0, max));
}

/** Clamp any raw score into the 0..1 confidence range. */
export function clampConfidence(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
