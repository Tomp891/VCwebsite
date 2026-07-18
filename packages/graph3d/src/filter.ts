import type { AtlasNode, AtlasLink, LayerKind, LinkStyle, LayeredGraph } from "./synthesize.js";

/** How filtered-out elements are treated. */
export type FilterMode = "dim" | "hide";

/**
 * Declarative filter over the layered graph. Every axis maps directly to the
 * frozen contract fields. When a field is omitted it does not constrain.
 */
export interface GraphFilter {
  /** show/hide by edge trust tier; omitted styles default to visible. */
  tiers?: Partial<Record<LinkStyle, boolean>>;
  /** hide edges below this confidence (0..1). */
  minConfidence?: number;
  /** show/hide by abstraction layer; omitted layers default to visible. */
  layers?: Partial<Record<LayerKind, boolean>>;
  /** if non-empty, only these clusters stay active. */
  clusters?: number[];
  /** root of an n-hop focus; defaults to the component's `selectedId`. */
  focusId?: string;
  /** hops from `focusId` to keep (default 1). */
  focusDepth?: number;
  /** dim (fade to pencil, keep context) vs hide (visibility off). default "dim". */
  mode?: FilterMode;
}

/** Runtime link endpoints become node objects once the sim starts; read the id either way. */
export function endpointId(end: AtlasLink["source"] | AtlasNode): string {
  if (typeof end === "string") return end;
  if (typeof end === "number") return String(end);
  return end.id;
}

/** BFS the precomputed adjacency to the set of node ids within `depth` hops of `rootId`. */
export function computeFocusSet(graph: LayeredGraph, rootId: string, depth: number): Set<string> {
  const byId = new Map<string, AtlasNode>(graph.nodes.map((n) => [n.id, n]));
  const seen = new Set<string>();
  if (!byId.has(rootId)) return seen;
  let frontier: string[] = [rootId];
  seen.add(rootId);
  for (let hop = 0; hop < depth; hop++) {
    const next: string[] = [];
    for (const id of frontier) {
      const node = byId.get(id);
      if (!node) continue;
      for (const nb of node.neighborIds) {
        if (!seen.has(nb)) {
          seen.add(nb);
          next.push(nb);
        }
      }
    }
    frontier = next;
  }
  return seen;
}

/** A compiled predicate pair plus whether any constraint is actually in effect. */
export interface CompiledFilter {
  active: boolean;
  nodeActive(node: AtlasNode): boolean;
  linkActive(link: AtlasLink): boolean;
}

const ALWAYS: CompiledFilter = { active: false, nodeActive: () => true, linkActive: () => true };

export function compileFilter(
  graph: LayeredGraph,
  filter: GraphFilter | undefined,
  selectedId: string | undefined,
): CompiledFilter {
  if (!filter) return ALWAYS;

  const { tiers, minConfidence, layers, clusters, focusDepth } = filter;
  const focusId = filter.focusId ?? selectedId;

  const clusterSet = clusters && clusters.length > 0 ? new Set(clusters) : null;
  const focusSet = focusId ? computeFocusSet(graph, focusId, focusDepth ?? 1) : null;
  const minConf = minConfidence ?? 0;

  const active =
    !!tiers ||
    minConf > 0 ||
    !!layers ||
    !!clusterSet ||
    !!focusSet;

  if (!active) return ALWAYS;

  const nodeById = new Map<string, AtlasNode>(graph.nodes.map((n) => [n.id, n]));

  const nodeActive = (node: AtlasNode): boolean => {
    if (layers && layers[node.layer] === false) return false;
    if (clusterSet && !clusterSet.has(node.cluster)) return false;
    if (focusSet && !focusSet.has(node.id)) return false;
    return true;
  };

  const linkActive = (link: AtlasLink): boolean => {
    if (tiers && tiers[link.style] === false) return false;
    if (link.confidence < minConf) return false;
    const src = nodeById.get(endpointId(link.source));
    const dst = nodeById.get(endpointId(link.target));
    if (src && !nodeActive(src)) return false;
    if (dst && !nodeActive(dst)) return false;
    return true;
  };

  return { active, nodeActive, linkActive };
}
