/**
 * @atlas/ai — embeddings + suggestion engine + review UI (Agent D).
 */

export {
  createMockProvider,
  createOllamaProvider,
  createFallbackProvider,
  probeOllama,
} from "./provider.js";
export type { OllamaOptions, OllamaProbe } from "./provider.js";
export {
  createAnthropicProvider,
  createOpenAIProvider,
  createFrontierProvider,
} from "./frontier.js";
export type { FrontierEngine, FrontierOptions } from "./frontier.js";
export { cosineSimilarity } from "./similarity.js";
export {
  createSuggester,
  pairKey,
  SUGGESTION_THRESHOLD,
} from "./suggester.js";
export type { SuggesterOptions } from "./suggester.js";
export { SuggestionsPanel } from "./SuggestionsPanel.js";
export type { SuggestionsPanelProps } from "./SuggestionsPanel.js";
export { createMemoryStore } from "./memStore.js";
export { Demo } from "./Demo.js";

// Re-export text helpers that are useful to consumers wiring up tags.
export { keywords, sharedTerms } from "./text.js";
