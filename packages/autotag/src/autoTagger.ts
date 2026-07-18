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

/** Default neighbour fan-out for similarity recall. */
const DEFAULT_RECALL_K = 5;

/**
 * Keyphrase confidence weights. Keyphrases are a weaker signal than a tag
 * corroborated by similar notes, so their raw salience is discounted; a phrase
 * that maps onto the existing taxonomy is trusted a little more than a brand-new
 * one because it reuses the user's vocabulary.
 */
const KEYPHRASE_TAXONOMY_WEIGHT = 0.8;
const KEYPHRASE_NEW_WEIGHT = 0.65;

/** Read a block's tags defensively — `props.tags` is `string[] | undefined`. */
function readTags(block: Block): string[] {
  const raw = block.props.tags;
  return Array.isArray(raw) ? raw : [];
}

/** Create a suggest-only AutoTagger bound to a corpus of blocks. */
export function createAutoTagger(opts: AutoTaggerOptions = {}): AutoTagger {
  const blocks = opts.blocks ?? [];
  const minConfidence = opts.minConfidence ?? DEFAULT_TAG_THRESHOLD;
  const maxSuggestions = opts.maxSuggestions ?? MAX_SUGGESTIONS;
  const recallK = opts.recallK ?? DEFAULT_RECALL_K;
  const taxonomy = buildTaxonomy(blocks);

  return {
    async suggest(
      block: Block,
      index?: EmbeddingIndex,
    ): Promise<TagSuggestion[]> {
      // Tags the block already carries (normalized) are never re-suggested.
      const existingTags = new Set(readTags(block).map(normalizeTag));

      // Best candidate per canonical tag. Filled in source-priority order
      // (similarity first) so that on a confidence tie the richer
      // "existing-similarity" reason/source wins.
      const merged = new Map<string, TagSuggestion>();
      const consider = (candidate: TagSuggestion): void => {
        if (!candidate.tag || existingTags.has(candidate.tag)) return;
        const prev = merged.get(candidate.tag);
        if (!prev || candidate.confidence > prev.confidence) {
          merged.set(candidate.tag, candidate);
        }
      };

      // Signal 1: tags recalled from the most similar existing notes.
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

      // Signal 2: keyphrases extracted from this block's own content.
      for (const kp of extractKeyphrases(block.content)) {
        const { tag, isNew } = dedupeAgainstTaxonomy(kp.phrase, taxonomy);
        if (!tag) continue;
        const weight = isNew ? KEYPHRASE_NEW_WEIGHT : KEYPHRASE_TAXONOMY_WEIGHT;
        consider({
          blockId: block.id,
          tag,
          confidence: clampConfidence(kp.score * weight),
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
