/**
 * Suggestion engine: embeds block contents, computes pairwise cosine similarity,
 * and proposes `related` links for similar-but-unlinked pairs.
 */

import type { AIProvider, Block, Suggester, Suggestion } from "@atlas/contracts";
import { cosineSimilarity } from "./similarity.js";
import { keywords, sharedTerms } from "./text.js";

/** Pairs at or above this cosine similarity become suggestions. */
export const SUGGESTION_THRESHOLD = 0.7;

export interface SuggesterOptions {
  /** cosine-similarity cutoff (default 0.7). */
  threshold?: number;
  /** already-linked pairs to exclude, as `${src}|${dst}` (order-insensitive). */
  existingPairs?: Iterable<string>;
}

export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function createSuggester(
  provider: AIProvider,
  options: SuggesterOptions = {},
): Suggester {
  const threshold = options.threshold ?? SUGGESTION_THRESHOLD;
  const existing = new Set(options.existingPairs ?? []);

  return {
    async suggestLinks(blocks: Block[]): Promise<Suggestion[]> {
      const usable = blocks.filter((b) => b.content.trim().length > 0);
      if (usable.length < 2) return [];

      const vectors = await provider.embed(usable.map((b) => b.content));
      const suggestions: Suggestion[] = [];

      for (let i = 0; i < usable.length; i++) {
        for (let j = i + 1; j < usable.length; j++) {
          const a = usable[i];
          const b = usable[j];
          if (existing.has(pairKey(a.id, b.id))) continue;

          const sim = cosineSimilarity(vectors[i], vectors[j]);
          if (sim < threshold) continue;

          suggestions.push({
            srcBlockId: a.id,
            dstBlockId: b.id,
            confidence: sim,
            reason: buildReason(sim, a.content, b.content),
          });
        }
      }

      suggestions.sort((x, y) => y.confidence - x.confidence);
      return suggestions;
    },

    async suggestTags(block: Block): Promise<string[]> {
      return keywords(block.content, 5);
    },
  };
}

function buildReason(sim: number, a: string, b: string): string {
  const pct = Math.round(sim * 100);
  const terms = sharedTerms(a, b).slice(0, 4);
  if (terms.length === 0) {
    return `${pct}% similar: closely related phrasing`;
  }
  return `${pct}% similar: shared terms ${terms.join(", ")}`;
}
