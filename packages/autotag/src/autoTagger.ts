/**
 * AutoTagger implementation — assembles TagSuggestion[] for a block from two
 * local signals (existing-tag similarity recall + keyphrase extraction), dedupes
 * them against the taxonomy, thresholds for confidence and returns suggest-only
 * results with human-readable reasons. Never mutates the block.
 *
 * Subagent (e) owns this file.
 */

import type {
  AutoTagger,
  Block,
  EmbeddingIndex,
  TagSuggestion,
} from "@atlas/contracts";
import { extractKeyphrases } from "./text.js";
import {
  buildTaxonomy,
  dedupeAgainstTaxonomy,
  normalizeTag,
} from "./normalize.js";
import { recallExistingTags } from "./similarity.js";
import {
  applyThreshold,
  clampConfidence,
  DEFAULT_TAG_THRESHOLD,
  MAX_SUGGESTIONS,
} from "./threshold.js";

export interface AutoTaggerOptions {
  /** corpus used for taxonomy + similarity recall. */
  blocks?: Block[];
  minConfidence?: number;
  maxSuggestions?: number;
  /** neighbours to inspect during similarity recall. */
  recallK?: number;
}

/** Create a suggest-only AutoTagger bound to a corpus of blocks. */
export function createAutoTagger(opts: AutoTaggerOptions = {}): AutoTagger {
  const blocks = opts.blocks ?? [];
  const minConfidence = opts.minConfidence ?? DEFAULT_TAG_THRESHOLD;
  const maxSuggestions = opts.maxSuggestions ?? MAX_SUGGESTIONS;
  const recallK = opts.recallK ?? 5;
  const taxonomy = buildTaxonomy(blocks);

  return {
    async suggest(block: Block, index?: EmbeddingIndex): Promise<TagSuggestion[]> {
      const existingTags = new Set(
        ((block.props.tags as string[] | undefined) ?? []).map(normalizeTag),
      );

      // Best confidence + reason per candidate tag, preferring similarity source.
      const merged = new Map<string, TagSuggestion>();
      const consider = (s: TagSuggestion) => {
        if (!s.tag || existingTags.has(s.tag)) return;
        const prev = merged.get(s.tag);
        if (!prev || s.confidence > prev.confidence) merged.set(s.tag, s);
      };

      // Signal 1: existing-tag similarity recall.
      for (const rec of recallExistingTags(block, blocks, index, recallK)) {
        const { tag } = dedupeAgainstTaxonomy(rec.tag, taxonomy);
        if (!tag) continue;
        consider({
          blockId: block.id,
          tag,
          confidence: clampConfidence(rec.score),
          source: "existing-similarity",
          reason: rec.reason,
        });
      }

      // Signal 2: keyphrase extraction.
      for (const kp of extractKeyphrases(block.content)) {
        const { tag, isNew } = dedupeAgainstTaxonomy(kp.phrase, taxonomy);
        if (!tag) continue;
        // slightly discount brand-new keyphrase tags vs. reused taxonomy tags.
        const confidence = clampConfidence(kp.score * (isNew ? 0.65 : 0.8));
        consider({
          blockId: block.id,
          tag,
          confidence,
          source: "keyphrase",
          reason: isNew
            ? `Key phrase "${kp.phrase}" in this note`
            : `Key phrase matches existing tag "${tag}"`,
        });
      }

      return applyThreshold([...merged.values()], {
        minConfidence,
        maxSuggestions,
      });
    },
  };
}
