/**
 * Directed, weighted graph derived from blocks (integrator-owned shared model).
 *
 * The frozen `Ranker.rank(blocks)` contract only receives blocks, so the edge
 * graph used by the pagerank/degree signals is derived here from:
 *   - explicit `[[wikilink]]` references in block content,
 *   - the parent/child hierarchy (`parentId`),
 *   - optional caller-supplied edges (e.g. `EditorStore.listEdges()`),
 *   - optional shared-tag co-occurrence (weak, off by default).
 *
 * Deterministic: node order follows the input block order, and adjacency lists
 * preserve insertion order so downstream algorithms are reproducible.
 */

import type { Block, BlockId, Edge } from "@atlas/contracts";

export interface WeightedEdge {
  to: BlockId;
  weight: number;
}
export interface WeightedInEdge {
  from: BlockId;
  weight: number;
}

export interface RankGraph {
  /** all node ids, in input order. */
  nodes: BlockId[];
  /** outgoing weighted adjacency. */
  outEdges: Map<BlockId, WeightedEdge[]>;
  /** incoming weighted adjacency (transpose of outEdges). */
  inEdges: Map<BlockId, WeightedInEdge[]>;
}

export interface BuildGraphOptions {
  /** caller-supplied edges to fold in (real app passes EditorStore edges). */
  edges?: Edge[];
  /** derive weak edges between blocks that share a tag. Default false. */
  useTagCooccurrence?: boolean;
  /** derive edges from parent/child hierarchy. Default true. */
  useHierarchy?: boolean;
  /** derive edges from `[[wikilink]]` references in content. Default true. */
  useWikilinks?: boolean;
}

const WIKILINK_RE = /\[\[([^\]]+)\]\]/g;

function addEdge(
  out: Map<BlockId, WeightedEdge[]>,
  inc: Map<BlockId, WeightedInEdge[]>,
  from: BlockId,
  to: BlockId,
  weight: number,
): void {
  if (from === to) return;
  if (!out.has(from) || !out.has(to)) return; // ignore dangling targets
  const list = out.get(from)!;
  const existing = list.find((e) => e.to === to);
  if (existing) {
    existing.weight += weight;
  } else {
    list.push({ to, weight });
  }
  const inList = inc.get(to)!;
  const inExisting = inList.find((e) => e.from === from);
  if (inExisting) {
    inExisting.weight += weight;
  } else {
    inList.push({ from, weight });
  }
}

/** Resolve a wikilink target (id or human label) to a block id, if any. */
function resolveTarget(
  raw: string,
  byId: Set<BlockId>,
  byLabel: Map<string, BlockId>,
): BlockId | undefined {
  const name = raw.trim();
  if (byId.has(name)) return name;
  return byLabel.get(name.toLowerCase());
}

export function buildGraph(blocks: Block[], opts: BuildGraphOptions = {}): RankGraph {
  const {
    edges,
    useTagCooccurrence = false,
    useHierarchy = true,
    useWikilinks = true,
  } = opts;

  const nodes = blocks.map((b) => b.id);
  const nodeSet = new Set(nodes);
  const outEdges = new Map<BlockId, WeightedEdge[]>();
  const inEdges = new Map<BlockId, WeightedInEdge[]>();
  for (const id of nodes) {
    outEdges.set(id, []);
    inEdges.set(id, []);
  }

  // Label map for resolving wikilinks by title (first line / first 40 chars).
  const byLabel = new Map<string, BlockId>();
  for (const b of blocks) {
    const title = (b.content.split("\n")[0] ?? "").trim().toLowerCase();
    if (title && !byLabel.has(title)) byLabel.set(title, b.id);
    const short = b.content.slice(0, 40).trim().toLowerCase();
    if (short && !byLabel.has(short)) byLabel.set(short, b.id);
  }

  if (useWikilinks) {
    for (const b of blocks) {
      WIKILINK_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = WIKILINK_RE.exec(b.content)) !== null) {
        const to = resolveTarget(m[1], nodeSet, byLabel);
        if (to) addEdge(outEdges, inEdges, b.id, to, 1);
      }
    }
  }

  if (useHierarchy) {
    for (const b of blocks) {
      if (b.parentId && nodeSet.has(b.parentId)) {
        // bidirectional: parent <-> child both carry structural importance.
        addEdge(outEdges, inEdges, b.id, b.parentId, 1);
        addEdge(outEdges, inEdges, b.parentId, b.id, 1);
      }
    }
  }

  if (edges) {
    for (const e of edges) {
      const w = Number.isFinite(e.confidence) ? Math.max(0, e.confidence) : 1;
      addEdge(outEdges, inEdges, e.srcBlockId, e.dstBlockId, w || 1);
    }
  }

  if (useTagCooccurrence) {
    const byTag = new Map<string, BlockId[]>();
    for (const b of blocks) {
      const tags = Array.isArray(b.props.tags) ? (b.props.tags as string[]) : [];
      for (const t of tags) {
        const arr = byTag.get(t) ?? [];
        arr.push(b.id);
        byTag.set(t, arr);
      }
    }
    for (const ids of byTag.values()) {
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          addEdge(outEdges, inEdges, ids[i], ids[j], 0.25);
          addEdge(outEdges, inEdges, ids[j], ids[i], 0.25);
        }
      }
    }
  }

  return { nodes, outEdges, inEdges };
}
