/**
 * @atlas/embeddings — deterministic, local-first embeddings + vector index.
 *
 * Implements the frozen contract's `EmbeddingProvider`, `EmbeddingIndex` and
 * `EmbeddingRecord` with a no-cost mock provider by default. A real provider
 * (Ollama/API) can implement `EmbeddingProvider` with zero consumer changes.
 */

export { createMockProvider, type MockProviderOptions } from "./provider.js";
export { blockText, blockHash, contentHash } from "./hash.js";
export {
  cosineSimilarity,
  nearest,
  dot,
  norm,
  type Scored,
} from "./cosine.js";
export {
  createMemoryStore,
  createIndexedDBStore,
  type EmbeddingStore,
  type IndexedDBStoreOptions,
} from "./store.js";
export {
  createEmbeddingIndex,
  type EmbeddingIndexOptions,
} from "./embeddingIndex.js";

export type {
  EmbeddingProvider,
  EmbeddingIndex,
  EmbeddingRecord,
} from "@atlas/contracts";
