/**
 * (d) Confidence scoring for a named theme (0..1).
 *
 * Blends cluster cohesion, size, and keyphrase support into a single score so
 * the UI can render weak/ambient themes faintly and strong ones boldly.
 * Deterministic and pure.
 */

import type { Block, Cluster } from "@atlas/contracts";

/** Clamp a number into the inclusive [0, 1] range. */
export function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/**
 * Score how confident we are in a theme's label/summary. Combines the cluster's
 * intrinsic cohesion with evidence strength (number of members and keyphrases).
 */
export function scoreConfidence(
  cluster: Cluster,
  blocks: Block[],
  keyphrases: string[],
): number {
  const cohesion = clamp01(cluster.cohesion);
  const size = cluster.blockIds.length || blocks.length;
  const sizeFactor = clamp01(size / 5);
  const phraseFactor = clamp01(keyphrases.length / 3);
  const score = 0.6 * cohesion + 0.25 * sizeFactor + 0.15 * phraseFactor;
  return clamp01(score);
}
