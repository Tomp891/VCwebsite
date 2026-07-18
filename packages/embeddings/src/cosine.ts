/**
 * (e) Cosine similarity + nearest-neighbour math.
 *
 * Pure, dependency-free vector helpers. All embeddings produced by the mock
 * provider are already unit-length, but these functions normalise defensively
 * so they are correct for any input.
 */

import type { BlockId } from "@atlas/contracts";

/** Dot product of two equal-length vectors. */
export function dot(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < n; i++) sum += a[i] * b[i];
  return sum;
}

/** Euclidean (L2) norm of a vector. */
export function norm(a: readonly number[]): number {
  return Math.sqrt(dot(a, a));
}

/**
 * Cosine similarity in [-1, 1]. Returns 0 for empty or zero-length vectors
 * (rather than NaN) so callers never have to guard against degenerate input.
 */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  const na = norm(a);
  const nb = norm(b);
  if (na === 0 || nb === 0) return 0;
  return dot(a, b) / (na * nb);
}

/** A scored neighbour, best first when returned from `nearest`. */
export interface Scored {
  id: BlockId;
  score: number;
}

/**
 * Rank `candidates` by cosine similarity to `target`, best first.
 * `excludeId` drops self-matches; `k` caps the result (k <= 0 => all).
 */
export function nearest(
  target: readonly number[],
  candidates: ReadonlyArray<{ id: BlockId; vector: readonly number[] }>,
  k: number,
  excludeId?: BlockId,
): Scored[] {
  const scored: Scored[] = [];
  for (const c of candidates) {
    if (excludeId !== undefined && c.id === excludeId) continue;
    scored.push({ id: c.id, score: cosineSimilarity(target, c.vector) });
  }
  scored.sort((x, y) => y.score - x.score || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  return k > 0 ? scored.slice(0, k) : scored;
}
