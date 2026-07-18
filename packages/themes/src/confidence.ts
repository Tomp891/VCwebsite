/**
 * (d) Confidence scoring for a named theme (0..1).
 *
 * Blends cluster cohesion, evidence size, keyphrase support and how much of the
 * cluster actually resolves to real blocks into a single score so the UI can
 * render weak/ambient themes faintly and strong ones boldly.
 * Deterministic and pure — no network, stable output for the same input.
 */

import type { Block, Cluster } from "@atlas/contracts";

/** Clamp a number into the inclusive [0, 1] range, mapping NaN -> 0. */
export function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/**
 * Weight budget (sums to 1 so the blend is guaranteed to land in [0, 1]):
 *   - cohesion  0.55  primary signal: the cluster's intrinsic tightness.
 *   - size      0.20  evidence strength: more members => more confidence.
 *   - phrases   0.15  keyphrase support: distinct extracted phrases.
 *   - coverage  0.10  fraction of cluster.blockIds that resolve to a real block.
 */
const W_COHESION = 0.55;
const W_SIZE = 0.2;
const W_PHRASES = 0.15;
const W_COVERAGE = 0.1;

/**
 * Saturating "diminishing returns" curve: 0 at n=0, approaching 1 as n grows,
 * reaching ~0.63 at n === tau. Used so extra evidence beyond a handful of
 * members / phrases barely moves the score.
 */
function saturate(n: number, tau: number): number {
  if (n <= 0) return 0;
  return clamp01(1 - Math.exp(-n / tau));
}

/**
 * Score how confident we are in a theme's label/summary. Combines the cluster's
 * intrinsic cohesion with evidence strength (member count and distinct
 * keyphrases) and how completely the cluster resolves to supplied blocks.
 * Always returns a value within [0, 1].
 */
export function scoreConfidence(
  cluster: Cluster,
  blocks: Block[],
  keyphrases: string[],
): number {
  const cohesion = clamp01(cluster.cohesion);

  // Evidence size: number of member blocks actually supplied, saturating ~5.
  const memberCount = blocks.length;
  const sizeFactor = saturate(memberCount, 5);

  // Keyphrase support: count of distinct, non-empty phrases, saturating ~3.
  const distinctPhrases = new Set(
    keyphrases
      .map((p) => p.trim().toLowerCase())
      .filter((p) => p.length > 0),
  ).size;
  const phraseFactor = saturate(distinctPhrases, 3);

  // Coverage: fraction of the cluster's declared blockIds that resolve to a
  // block in `blocks`. Empty clusters get 0 (no evidence to be confident in).
  const declared = cluster.blockIds.length;
  let coverageFactor = 0;
  if (declared > 0) {
    const present = new Set(blocks.map((b) => b.id));
    let resolved = 0;
    for (const id of cluster.blockIds) {
      if (present.has(id)) resolved += 1;
    }
    coverageFactor = clamp01(resolved / declared);
  }

  const score =
    W_COHESION * cohesion +
    W_SIZE * sizeFactor +
    W_PHRASES * phraseFactor +
    W_COVERAGE * coverageFactor;

  return clamp01(score);
}
