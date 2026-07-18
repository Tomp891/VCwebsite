import type { EdgeType } from "@atlas/contracts";
import type { AtlasNode, AtlasLink, LayerKind, LinkStyle, LayeredGraph } from "./synthesize.js";

/** How filtered-out elements are treated. */
export type FilterMode = "dim" | "hide" | "prune";

/** Which edge direction counts when expanding a focus neighborhood. */
export type FocusDirection = "all" | "in" | "out";

/** Optional lookup so tag filtering works even though `GraphNode` carries no tags
 *  (tags live on `Block.props`; integration supplies them per node id). */
export type TagsById = Record<string, string[]>;

/**
 * Declarative filter over the layered graph. Every axis maps directly to the
 * frozen contract fields. When a field is omitted it does not constrain.
 */
export interface GraphFilter {
  /** show/hide by edge trust tier; omitted styles default to visible. */
  tiers?: Partial<Record<LinkStyle, boolean>>;
  /** show/hide by edge *type* (link / ref / tag / related / ...); omitted types default to visible. */
  types?: Partial<Record<EdgeType, boolean>>;
  /** hide edges below this confidence (0..1). */
  minConfidence?: number;
  /** show/hide by abstraction layer; omitted layers default to visible. */
  layers?: Partial<Record<LayerKind, boolean>>;
  /** if non-empty, only these clusters stay active. */
  clusters?: number[];
  /** if non-empty, only nodes carrying at least one of these tags stay active (needs tagsById). */
  tags?: string[];
  /** case-insensitive substring match over node labels. */
  search?: string;
  /** externally computed match set (e.g. a GraphRAG `RetrievedContext.path`); if
   *  non-empty, only these node ids stay active. Enables semantic search. */
  matchIds?: string[];
  /** root of an n-hop focus. Focus is only applied when this is set. */
  focusId?: string;
  /** hops from `focusId` to keep (default 1). */
  focusDepth?: number;
  /** which edge direction to traverse from `focusId`: all / incoming (backlinks) / outgoing. */
  focusDirection?: FocusDirection;
  /** restrict focus traversal to these edge types (e.g. link+ref for backlinks). */
  focusTypes?: EdgeType[];
  /** dim (fade to pencil, keep context), hide (visibility off, layout preserved),
   *  or prune (rebuild graphData from the active set — for large graphs). default "dim". */
  mode?: FilterMode;
}

/** Runtime link endpoints become node objects once the sim starts; read the id either way. */
export function endpointId(end: AtlasLink["source"] | AtlasNode): string {
  if (typeof end === "string") return end;
  if (typeof end === "number") return String(end);
  return end.id;
}

export interface FocusOptions {
  direction?: FocusDirection;
  types?: Set<EdgeType>;
}

/** BFS the precomputed directed/typed adjacency to node ids within `depth` hops of `rootId`. */
export function computeFocusSet(
  graph: LayeredGraph,
  rootId: string,
  depth: number,
  opts: FocusOptions = {},
): Set<string> {
  const direction = opts.direction ?? "all";
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
      for (const a of node.adj) {
        if (direction !== "all" && a.dir !== direction) continue;
        if (opts.types && !(a.type !== undefined && opts.types.has(a.type))) continue;
        if (!seen.has(a.id)) {
          seen.add(a.id);
          next.push(a.id);
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

export interface CompileOptions {
  tagsById?: TagsById;
}

export function compileFilter(
  graph: LayeredGraph,
  filter: GraphFilter | undefined,
  opts: CompileOptions = {},
): CompiledFilter {
  if (!filter) return ALWAYS;

  const { tiers, types, minConfidence, layers, clusters, tags, focusId, focusDepth } = filter;

  const clusterSet = clusters && clusters.length > 0 ? new Set(clusters) : null;
  const tagSet = tags && tags.length > 0 ? new Set(tags) : null;
  const matchSet = filter.matchIds && filter.matchIds.length > 0 ? new Set(filter.matchIds) : null;
  const search = filter.search?.trim().toLowerCase() || null;
  const focusSet = focusId
    ? computeFocusSet(graph, focusId, focusDepth ?? 1, {
        direction: filter.focusDirection,
        types: filter.focusTypes && filter.focusTypes.length > 0 ? new Set(filter.focusTypes) : undefined,
      })
    : null;
  const minConf = minConfidence ?? 0;
  const tagsById = opts.tagsById;

  const active =
    !!tiers ||
    !!types ||
    minConf > 0 ||
    !!layers ||
    !!clusterSet ||
    !!tagSet ||
    !!matchSet ||
    !!search ||
    !!focusSet;

  if (!active) return ALWAYS;

  const nodeById = new Map<string, AtlasNode>(graph.nodes.map((n) => [n.id, n]));

  const nodeActive = (node: AtlasNode): boolean => {
    if (layers && layers[node.layer] === false) return false;
    if (clusterSet && !clusterSet.has(node.cluster)) return false;
    if (focusSet && !focusSet.has(node.id)) return false;
    if (matchSet && !matchSet.has(node.id)) return false;
    if (search && !node.label.toLowerCase().includes(search)) return false;
    if (tagSet) {
      const nodeTags = tagsById?.[node.id];
      if (!nodeTags || !nodeTags.some((t) => tagSet.has(t))) return false;
    }
    return true;
  };

  const linkActive = (link: AtlasLink): boolean => {
    if (tiers && tiers[link.style] === false) return false;
    if (types && link.type !== undefined && types[link.type] === false) return false;
    if (link.confidence < minConf) return false;
    const src = nodeById.get(endpointId(link.source));
    const dst = nodeById.get(endpointId(link.target));
    if (src && !nodeActive(src)) return false;
    if (dst && !nodeActive(dst)) return false;
    return true;
  };

  return { active, nodeActive, linkActive };
}
