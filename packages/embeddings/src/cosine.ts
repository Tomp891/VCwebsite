/**
 * (e) Cosine similarity + nearest-neighbour math.
 *
 * Pure, dependency-free vector helpers. All embeddings produced by the mock
 * provider are already unit-length, but these functions normalise defensively
 * so they are correct for any input.
 *
 * Robustness contract:
 *  - Never return NaN/Infinity: degenerate input (empty, zero-length, NaN
 *    components) collapses to a similarity of 0.
 *  - Length mismatches are handled by comparing over the shared prefix.
 *  - `nearest` is deterministic: results are ranked best-first with a stable
 *    tie-break on `id`, so equal scores always come back in the same order.
 */

import type { BlockId } from "@atlas/contracts";

/**
 * Dot product over the shared prefix of two vectors. Non-finite products
 * (from NaN/Infinity components) are treated as 0 so the result stays finite.
 */
export function dot(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const p = a[i] * b[i];
    if (Number.isFinite(p)) sum += p;
  }
  return sum;
}

/** Euclidean (L2) norm of a vector. Always finite and >= 0. */
export function norm(a: readonly number[]): number {
  const d = dot(a, a);
  return d > 0 ? Math.sqrt(d) : 0;
}

/**
 * Cosine similarity in [-1, 1]. Returns 0 for empty, zero-length or otherwise
 * degenerate vectors (rather than NaN) so callers never have to guard against
 * degenerate input. The result is clamped to [-1, 1] to absorb floating-point
 * error.
 */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  const na = norm(a);
  const nb = norm(b);
  if (na === 0 || nb === 0) return 0;
  const sim = dot(a, b) / (na * nb);
  if (!Number.isFinite(sim)) return 0;
  return sim < -1 ? -1 : sim > 1 ? 1 : sim;
}

/** A scored neighbour, best first when returned from `nearest`. */
export interface Scored {
  id: BlockId;
  score: number;
}

/** Deterministic, total ordering on ids for a stable tie-break. */
function compareIds(x: BlockId, y: BlockId): number {
  return x < y ? -1 : x > y ? 1 : 0;
}

/**
 * Rank `candidates` by cosine similarity to `target`, best (highest score)
 * first. `excludeId` drops self-matches; `k` caps the result (k <= 0 => all).
 * Ties on score are broken by ascending `id`, so the ordering is fully
 * deterministic and stable across runs regardless of candidate input order.
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
  scored.sort((x, y) => y.score - x.score || compareIds(x.id, y.id));
  return k > 0 && k < scored.length ? scored.slice(0, k) : scored;
}
