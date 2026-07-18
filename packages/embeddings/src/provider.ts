/**
 * (a) Deterministic mock EmbeddingProvider.
 *
 * Uses signed feature-hashing (the "hashing trick", Weinberger et al. 2009) so
 * that texts sharing tokens land on overlapping dimensions and therefore score
 * high on cosine similarity — i.e. the vectors are *semantically meaningful* for
 * a mock, while being fully deterministic and requiring no model or network.
 *
 * Properties guaranteed:
 *  - Deterministic: identical input -> identical output, across runs, Node and
 *    the browser (only String/Math primitives, no crypto, no locale-dependent
 *    APIs beyond `toLowerCase`).
 *  - Unit length: every non-empty text maps to an L2-normalised vector, so
 *    cosine similarity equals the dot product.
 *  - Degenerate-safe: empty / whitespace / punctuation-only / token-less input
 *    maps to the zero vector (cosine 0 against everything) rather than NaN.
 */

import type { EmbeddingProvider } from "@atlas/contracts";

const DEFAULT_DIMENSIONS = 64;
const FNV_OFFSET_BASIS = 0x811c9dc5;

/**
 * Split into lowercase alphanumeric tokens. Uses Unicode letter/number classes
 * so non-ASCII scripts (accents, Cyrillic, CJK, digits) still produce tokens
 * instead of being silently dropped. Returns `[]` for token-less input.
 */
function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

/**
 * FNV-1a 32-bit hash of a token, with an optional seed so we can derive several
 * independent hash streams (bucket index vs. sign) from the same token without
 * correlating them. Result is an unsigned 32-bit integer.
 */
function hashToken(token: string, seed = FNV_OFFSET_BASIS): number {
  let h = seed >>> 0;
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i);
    // 32-bit FNV prime multiply via shifts to stay within 32 bits.
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

/** Embed one text into an L2-normalised vector of length `dimensions`. */
function embedOne(text: string, dimensions: number): number[] {
  const vec = new Array<number>(dimensions).fill(0);
  // Guard against non-string runtime inputs (callers outside TS may pass these).
  const tokens = tokenize(typeof text === "string" ? text : String(text ?? ""));

  for (const token of tokens) {
    const bucketHash = hashToken(token);
    // A second, independent hash stream picks the sign so it does not correlate
    // with the chosen bucket — this keeps ±1 contributions balanced and avoids
    // systematic bias when many tokens collide on the same dimension.
    const signHash = hashToken(token, 0x9e3779b1);
    const idx = bucketHash % dimensions;
    const sign = signHash & 1 ? 1 : -1;
    vec[idx] += sign;
  }

  // L2-normalise so cosine == dot and token count doesn't skew magnitude.
  let sumSq = 0;
  for (let i = 0; i < dimensions; i++) sumSq += vec[i] * vec[i];
  const mag = Math.sqrt(sumSq);
  // Token-less or perfectly-cancelling input yields a zero vector; leave it as
  // zeros (a valid, degenerate embedding) rather than dividing by ~0.
  if (mag > 0 && Number.isFinite(mag)) {
    for (let i = 0; i < dimensions; i++) vec[i] /= mag;
  }
  return vec;
}

export interface MockProviderOptions {
  /** vector length; defaults to 64. Must be a positive integer. */
  dimensions?: number;
  /** provider id recorded on EmbeddingRecord.model; defaults to "mock-v1". */
  id?: string;
}

/**
 * Create a deterministic, no-cost EmbeddingProvider. The same text always maps
 * to the same unit vector; texts with shared tokens are close under cosine.
 *
 * @throws RangeError if `dimensions` is not a positive integer.
 */
export function createMockProvider(options: MockProviderOptions = {}): EmbeddingProvider {
  const dimensions = options.dimensions ?? DEFAULT_DIMENSIONS;
  if (!Number.isInteger(dimensions) || dimensions <= 0) {
    throw new RangeError(
      `createMockProvider: dimensions must be a positive integer, got ${String(dimensions)}`,
    );
  }
  const id = options.id ?? "mock-v1";
  return {
    id,
    dimensions,
    async embed(texts: string[]): Promise<number[][]> {
      // Tolerate a missing/non-array argument rather than throwing at runtime.
      if (!Array.isArray(texts)) return [];
      return texts.map((t) => embedOne(t, dimensions));
    },
  };
}
