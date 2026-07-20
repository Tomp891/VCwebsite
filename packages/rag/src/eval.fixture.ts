/**
 * A small labelled evaluation set over the contract mock knowledge base
 * (`mockBlocks` n1..n8). Each question maps to the block ids that should be
 * retrieved. Kept intentionally tiny and human-authored — the point is a stable,
 * inspectable baseline, not scale.
 */
import type { EvalDataset } from "./eval.js";

export const mockEvalDataset: EvalDataset = [
  { id: "graphrag", query: "How does GraphRAG combine vector search with graph traversal?", relevant: ["n3"] },
  { id: "embeddings", query: "What do embeddings do with semantically similar notes?", relevant: ["n2"] },
  { id: "local-first", query: "How do local-first apps keep data the user owns?", relevant: ["n4"] },
  { id: "ink-pencil", query: "Difference between manual ink links and AI pencil links", relevant: ["n6"] },
  { id: "3d-layers", query: "multilayer 3D graph of atoms concepts and domains", relevant: ["n7"] },
  { id: "crdt-offline", query: "CRDTs for offline editing and real-time collaboration", relevant: ["n8"] },
  { id: "bidirectional", query: "bidirectional links create emergent structure over time", relevant: ["n5"] },
  { id: "knowledge-graph", query: "knowledge graphs connect atomic notes into a navigable structure", relevant: ["n1"] },
];
