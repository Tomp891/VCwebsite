import type { EdgeType, GraphData, GraphLink, GraphNode } from "@atlas/contracts";
import type { NodeObject, LinkObject } from "3d-force-graph";
import { layerZ } from "./tokens.js";

/** A directed, typed adjacency entry precomputed per node. */
export interface Adjacency {
  id: string;
  /** "out" = this node is the edge source; "in" = this node is the target. */
  dir: "in" | "out";
  /** edge type for real edges; omitted for synthesized structure up-links. */
  type?: EdgeType;
}

export type LayerKind = "atom" | "concept" | "domain";

/** Where a node sits in the abstraction hierarchy. */
export type NodeKind = "block" | "concept" | "domain";

/** How an edge should be drawn: solid ink vs faint dashed pencil vs structural up-link. */
export type LinkStyle = "ink" | "pencil" | "structure";

export interface AtlasNode extends NodeObject {
  id: string;
  label: string;
  weight: number;
  cluster: number;
  layer: LayerKind;
  kind: NodeKind;
  /** fixed Z so each layer stays on its own plane. */
  fz: number;
  /** directed + typed adjacency — precomputed for cheap n-hop / backlink focus. */
  adj: Adjacency[];
}

export interface AtlasLink extends LinkObject<AtlasNode> {
  source: string;
  target: string;
  style: LinkStyle;
  confidence: number;
  /** underlying edge type for real edges; omitted for structure up-links. */
  type?: EdgeType;
}

export interface LayeredGraph {
  nodes: AtlasNode[];
  links: AtlasLink[];
}

function styleForTier(tier: GraphLink["tier"]): LinkStyle {
  // explicit + accepted are human-trusted "ink"; ambient AI stays "pencil".
  return tier === "inferred_ambient" ? "pencil" : "ink";
}

/**
 * The contract mock nodes are all `layer: "atom"`. To showcase the multilayer
 * atlas we synthesize the upper layers: one "concept" node per distinct cluster
 * (atoms link up to their concept) and a single "domain" node the concepts link
 * up to. Each layer is pinned to a Z plane (atom 0, concept +120, domain +240).
 */
export function toLayeredGraph(data: GraphData): LayeredGraph {
  const atoms: AtlasNode[] = data.nodes.map((n: GraphNode) => ({
    id: n.id,
    label: n.label,
    weight: n.weight,
    cluster: n.cluster,
    layer: "atom",
    kind: "block",
    fz: layerZ.atom,
    adj: [],
  }));

  const links: AtlasLink[] = data.links.map((l: GraphLink) => ({
    source: typeof l.source === "string" ? l.source : String(l.source),
    target: typeof l.target === "string" ? l.target : String(l.target),
    style: styleForTier(l.tier),
    confidence: l.confidence,
    type: l.type,
  }));

  const clusters = Array.from(new Set(data.nodes.map((n) => n.cluster))).sort((a, b) => a - b);

  const conceptId = (cluster: number) => `concept:${cluster}`;
  const domainId = "domain:root";

  const conceptNodes: AtlasNode[] = clusters.map((cluster) => {
    const members = atoms.filter((a) => a.cluster === cluster);
    const weight = members.reduce((sum, a) => sum + a.weight, 0);
    return {
      id: conceptId(cluster),
      label: `Concept ${cluster}`,
      weight,
      cluster,
      layer: "concept",
      kind: "concept",
      fz: layerZ.concept,
      adj: [],
    };
  });

  const domainNode: AtlasNode = {
    id: domainId,
    label: "Domain",
    weight: conceptNodes.reduce((sum, c) => sum + c.weight, 0),
    cluster: clusters[0] ?? 0,
    layer: "domain",
    kind: "domain",
    fz: layerZ.domain,
    adj: [],
  };

  // atom -> concept and concept -> domain structural up-links.
  const upLinks: AtlasLink[] = [];
  for (const atom of atoms) {
    upLinks.push({ source: atom.id, target: conceptId(atom.cluster), style: "structure", confidence: 1 });
  }
  for (const concept of conceptNodes) {
    upLinks.push({ source: concept.id, target: domainId, style: "structure", confidence: 1 });
  }

  const nodes = [...atoms, ...conceptNodes, domainNode];
  const allLinks = [...links, ...upLinks];

  // precompute directed + typed adjacency (extends the vasturiano highlight pattern)
  // so focus / n-hop / backlink filtering is O(1) per node.
  const byId = new Map<string, AtlasNode>(nodes.map((n) => [n.id, n]));
  for (const link of allLinks) {
    const a = byId.get(link.source);
    const b = byId.get(link.target);
    if (!a || !b) continue;
    a.adj.push({ id: b.id, dir: "out", type: link.type });
    b.adj.push({ id: a.id, dir: "in", type: link.type });
  }

  return { nodes, links: allLinks };
}
