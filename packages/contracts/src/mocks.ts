/**
 * Mock fixtures — realistic fake data so every package can build in isolation
 * before real wiring lands at integration.
 */

import type { Block, Edge } from "./model.js";
import type { GraphData, GraphNode, GraphLink } from "./api.js";

const now = Date.now();

function block(
  id: string,
  content: string,
  props: Block["props"] = {},
  type: Block["type"] = "text",
): Block {
  return { id, parentId: null, order: 0, type, content, props, createdAt: now, updatedAt: now };
}

export const mockBlocks: Block[] = [
  block("n1", "Knowledge graphs connect atomic notes into a navigable structure.", { tags: ["graph", "pkm"] }, "page"),
  block("n2", "Embeddings place semantically similar notes near each other.", { tags: ["ai", "embeddings"] }, "page"),
  block("n3", "GraphRAG combines vector search with n-hop graph traversal.", { tags: ["ai", "graph", "rag"] }, "page"),
  block("n4", "Local-first apps keep data as plain files the user owns.", { tags: ["architecture", "local-first"] }, "page"),
  block("n5", "Bidirectional links create emergent structure over time.", { tags: ["graph", "pkm"] }, "page"),
  block("n6", "Manual links are ink; AI links are pencil until accepted.", { tags: ["ai", "design"] }, "page"),
  block("n7", "A 3D multilayer graph separates atoms, concepts and domains.", { tags: ["graph", "3d", "design"] }, "page"),
  block("n8", "CRDTs enable offline editing and real-time collaboration.", { tags: ["architecture", "sync"] }, "page"),
];

export const mockEdges: Edge[] = [
  { id: "e1", srcBlockId: "n1", dstBlockId: "n5", type: "link", tier: "explicit", confidence: 1, provenance: { method: "wikilink" }, createdAt: now },
  { id: "e2", srcBlockId: "n2", dstBlockId: "n3", type: "link", tier: "explicit", confidence: 1, provenance: { method: "wikilink" }, createdAt: now },
  { id: "e3", srcBlockId: "n1", dstBlockId: "n3", type: "related", tier: "inferred_ambient", confidence: 0.82, provenance: { method: "cosine", detail: "high similarity: graph traversal" }, createdAt: now },
  { id: "e4", srcBlockId: "n2", dstBlockId: "n6", type: "related", tier: "inferred_ambient", confidence: 0.64, provenance: { method: "cosine" }, createdAt: now },
  { id: "e5", srcBlockId: "n4", dstBlockId: "n8", type: "related", tier: "inferred_accepted", confidence: 0.9, provenance: { method: "cosine", detail: "both architecture" }, createdAt: now },
  { id: "e6", srcBlockId: "n7", dstBlockId: "n1", type: "related", tier: "inferred_ambient", confidence: 0.58, provenance: { method: "cosine" }, createdAt: now },
];

const clusterByTag: Record<string, number> = { graph: 0, ai: 1, architecture: 2, pkm: 0, embeddings: 1, rag: 1, "local-first": 2, sync: 2, "3d": 0, design: 1 };

export function mockGraphData(): GraphData {
  const nodes: GraphNode[] = mockBlocks.map((b) => {
    const tags = (b.props.tags as string[] | undefined) ?? [];
    const degree = mockEdges.filter((e) => e.srcBlockId === b.id || e.dstBlockId === b.id).length;
    return {
      id: b.id,
      label: b.content.slice(0, 40),
      weight: 1 + degree,
      cluster: clusterByTag[tags[0]] ?? 0,
      layer: "atom",
    };
  });
  const links: GraphLink[] = mockEdges.map((e) => ({
    source: e.srcBlockId,
    target: e.dstBlockId,
    tier: e.tier,
    confidence: e.confidence,
    type: e.type,
  }));
  return { nodes, links };
}
