/**
 * @atlas/autotag — local, suggest-only autotagging + keyphrase extraction
 * (Emergent Agent 4). Implements the frozen `AutoTagger` / `TagSuggestion`
 * contract from @atlas/contracts using deterministic local algorithms and the
 * optional EmbeddingIndex; no network, no paid APIs.
 */

export { createAutoTagger } from "./autoTagger.js";
export type { AutoTaggerOptions } from "./autoTagger.js";

export { extractKeyphrases, tokenize, contentTokens, isStopword } from "./text.js";
export type { Keyphrase } from "./text.js";

export {
  normalizeTag,
  buildTaxonomy,
  dedupeAgainstTaxonomy,
} from "./normalize.js";
export type { DedupeResult } from "./normalize.js";

export { recallExistingTags, lexicalSimilarity } from "./similarity.js";
export type { TagRecall } from "./similarity.js";

export {
  applyThreshold,
  clampConfidence,
  DEFAULT_TAG_THRESHOLD,
  MAX_SUGGESTIONS,
} from "./threshold.js";
export type { ThresholdOptions } from "./threshold.js";

// Re-export the contract types consumers use with this package.
export type { AutoTagger, TagSuggestion, TagSource } from "@atlas/contracts";
