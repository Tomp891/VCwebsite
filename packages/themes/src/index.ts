/**
 * @atlas/themes — theme naming & summarization (workstream 5).
 *
 * Implements the frozen `ThemeNamer` + `Theme` contract from @atlas/contracts:
 * turn a detected `Cluster` into a named, human-reviewable emergent `Theme`
 * (label, one-line summary, keyphrases, exemplars, confidence, review state).
 *
 * Local-first / no-cost: deterministic keyphrase labelling + extractive
 * summaries by default, no network calls.
 */

export { LocalThemeNamer, createThemeNamer } from "./namer.js";
export type { ThemeNamerOptions } from "./namer.js";

export { selectExemplars, centroidBlockId } from "./exemplars.js";
export { extractKeyphrases, buildLabel, serifCaps } from "./label.js";
export { summarize, firstSentence } from "./summary.js";
export { scoreConfidence, clamp01 } from "./confidence.js";
export {
  INITIAL_STATUS,
  applyReview,
  isPromoted,
  describeMethod,
} from "./review.js";
export type { ReviewStatus, ReviewAction, ThemeMethod } from "./review.js";
