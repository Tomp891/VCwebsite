/**
 * @atlas/rag — GraphRAG question answering with citations (Agent F).
 *
 * createRetriever(store, provider).retrieve(q) -> top-k blocks by cosine plus
 * their one-hop graph neighbours and a traversal path; answer(q, ctx, provider)
 * -> a grounded ChatAnswer with inline block-id citations; ChatPanel wires both
 * into a UI; Demo runs it all against the contract mock fixtures.
 */
export { createRetriever, DEFAULT_TOP_K, DEFAULT_HOPS } from "./retriever.js";
export type { RetrieverOptions } from "./retriever.js";
export { answer, buildPrompt, extractCitations } from "./answer.js";
export { cosine } from "./cosine.js";
export { ChatPanel } from "./ChatPanel.js";
export type { ChatPanelProps } from "./ChatPanel.js";
export { Demo, mockProvider, createMockStore } from "./Demo.js";
