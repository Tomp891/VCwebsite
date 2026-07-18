/**
 * Interface contracts between packages. Each Wave-1 agent implements or consumes
 * these against the mock fixtures so nobody blocks anybody.
 */

import type { Block, BlockId, Edge, EdgeId } from "./model.js";

/** Editor + storage layer (Agent A). */
export interface EditorStore {
  listBlocks(): Block[];
  getBlock(id: BlockId): Block | undefined;
  upsertBlock(block: Partial<Block> & { id: BlockId }): Block;
  createBlock(input: Omit<Block, "id" | "createdAt" | "updatedAt">): Block;
  deleteBlock(id: BlockId): void;

  listEdges(): Edge[];
  upsertEdge(edge: Omit<Edge, "id" | "createdAt"> & { id?: EdgeId }): Edge;
  deleteEdge(id: EdgeId): void;

  /** subscribe to any change; returns unsubscribe. */
  subscribe(fn: () => void): () => void;
}

/** Data shape consumed by the graph renderers (Agents B + C). */
export interface GraphNode {
  id: BlockId;
  label: string;
  /** importance -> node size. */
  weight: number;
  /** community/cluster id -> color. */
  cluster: number;
  layer: "atom" | "concept" | "domain";
}

export interface GraphLink {
  source: BlockId;
  target: BlockId;
  tier: Edge["tier"];
  confidence: number;
  type: Edge["type"];
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

/** Pluggable AI provider (Agent D). Ollama or API implement this. */
export interface AIProvider {
  embed(texts: string[]): Promise<number[][]>;
  chat(prompt: string): Promise<string>;
}

/** A single AI edge suggestion awaiting accept/reject. */
export interface Suggestion {
  srcBlockId: BlockId;
  dstBlockId: BlockId;
  confidence: number;
  reason: string;
}

/** AI suggestion engine (Agent D). */
export interface Suggester {
  suggestLinks(blocks: Block[]): Promise<Suggestion[]>;
  suggestTags(block: Block): Promise<string[]>;
}

/** GraphRAG retrieval result (Agent F). */
export interface RetrievedContext {
  blocks: Block[];
  /** ids forming the traversal path, for graph highlighting. */
  path: BlockId[];
}

export interface Retriever {
  retrieve(query: string): Promise<RetrievedContext>;
}

export interface ChatAnswer {
  text: string;
  citations: BlockId[];
  path: BlockId[];
}
