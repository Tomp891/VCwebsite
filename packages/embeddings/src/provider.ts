/**
 * (a) Deterministic mock EmbeddingProvider.
 *
 * Uses signed feature-hashing (a bag-of-words hashing trick) so that texts
 * sharing tokens land on overlapping dimensions and therefore score high on
 * cosine similarity — i.e. the vectors are *semantically meaningful* for a
 * mock, while being fully deterministic and requiring no model or network.
 */

import type { EmbeddingProvider } from "@atlas/contracts";

const DEFAULT_DIMENSIONS = 64;

/** Split into lowercase alphanumeric tokens. */
function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

/** FNV-1a 32-bit over a token; used to pick a dimension and a sign. */
function hashToken(token: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

/** Embed one text into a unit-length vector of length `dimensions`. */
function embedOne(text: string, dimensions: number): number[] {
  const vec = new Array<number>(dimensions).fill(0);
  const tokens = tokenize(text);
  for (const token of tokens) {
    const h = hashToken(token);
    const idx = h % dimensions;
    const sign = (h >>> 16) & 1 ? 1 : -1;
    vec[idx] += sign;
  }
  // Normalise to unit length so cosine == dot and magnitudes don't skew scores.
  let mag = 0;
  for (let i = 0; i < dimensions; i++) mag += vec[i] * vec[i];
  mag = Math.sqrt(mag);
  if (mag > 0) {
    for (let i = 0; i < dimensions; i++) vec[i] /= mag;
  }
  return vec;
}

export interface MockProviderOptions {
  /** vector length; defaults to 64. */
  dimensions?: number;
  /** provider id recorded on EmbeddingRecord.model; defaults to "mock-v1". */
  id?: string;
}

/**
 * Create a deterministic, no-cost EmbeddingProvider. The same text always maps
 * to the same unit vector; texts with shared tokens are close under cosine.
 */
export function createMockProvider(options: MockProviderOptions = {}): EmbeddingProvider {
  const dimensions = options.dimensions ?? DEFAULT_DIMENSIONS;
  const id = options.id ?? "mock-v1";
  return {
    id,
    dimensions,
    async embed(texts: string[]): Promise<number[][]> {
      return texts.map((t) => embedOne(t, dimensions));
    },
  };
}
