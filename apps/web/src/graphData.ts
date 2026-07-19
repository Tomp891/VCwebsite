import type { Block, Edge, GraphData, GraphNode, GraphLink } from "@atlas/contracts";

const clusterByTag: Record<string, number> = {
  graph: 0,
  pkm: 0,
  "3d": 0,
  ai: 1,
  embeddings: 1,
  rag: 1,
  design: 1,
  architecture: 2,
  "local-first": 2,
  sync: 2,
};

/** Derive live GraphData from the store's blocks + edges. */
export function storeToGraphData(blocks: Block[], edges: Edge[]): GraphData {
  const ids = new Set(blocks.map((b) => b.id));
  const nodes: GraphNode[] = blocks.map((b) => {
    const tags = (b.props.tags as string[] | undefined) ?? [];
    const degree = edges.filter((e) => e.srcBlockId === b.id || e.dstBlockId === b.id).length;
    return {
      id: b.id,
      label: (b.content || b.id).slice(0, 40),
      weight: 1 + degree,
      cluster: clusterByTag[tags[0]] ?? 0,
      layer: "atom",
    };
  });
  const links: GraphLink[] = edges
    .filter((e) => ids.has(e.srcBlockId) && ids.has(e.dstBlockId))
    .map((e) => ({
      source: e.srcBlockId,
      target: e.dstBlockId,
      tier: e.tier,
      confidence: e.confidence,
      type: e.type,
    }));
  return { nodes, links };
}
