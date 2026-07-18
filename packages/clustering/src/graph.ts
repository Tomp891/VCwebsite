/**
 * (a) Graph builder — derive a weighted, undirected adjacency graph from a set
 * of blocks (and, optionally, an EmbeddingIndex for similarity edges).
 *
 * Edges are inferred locally and deterministically from block content and
 * properties so clustering works with zero network cost:
 *   - resolved `[[wikilinks]]` in content
 *   - shared `props.tags`
 *   - parent/child hierarchy
 *   - k-nearest embedding neighbours (only when an index is provided)
 */

import type { Block, BlockId, EmbeddingIndex } from "@atlas/contracts";
import {
  DEFAULT_ADJACENCY_OPTIONS,
  type AdjacencyOptions,
  type WeightedGraph,
} from "./types.js";

const WIKILINK_RE = /\[\[([^[\]]+)\]\]/g;

/** Extract trimmed, de-duplicated [[wikilink]] targets from block content. */
export function parseWikilinks(content: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const match of content.matchAll(WIKILINK_RE)) {
    const text = match[1].trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

function blockTitle(block: Block): string {
  const title = block.props.title;
  if (typeof title === "string" && title.trim()) return title.trim();
  return block.content.trim();
}

/** Resolve a wikilink text to a block id (exact title match wins, else prefix). */
function resolveWikilink(linkText: string, blocks: Block[]): BlockId | undefined {
  const needle = linkText.trim().toLowerCase();
  if (!needle) return undefined;
  let prefix: BlockId | undefined;
  for (const block of blocks) {
    const title = blockTitle(block).toLowerCase();
    if (title === needle) return block.id;
    if (prefix === undefined && title.startsWith(needle)) prefix = block.id;
  }
  return prefix;
}

/**
 * Normalised, de-duplicated tag list for a block. Tolerates a missing/non-array
 * `tags` prop, non-string entries, surrounding whitespace and empty strings, and
 * collapses case- and whitespace-duplicate tags so a repeated tag on one block
 * never double-counts a shared-tag edge.
 */
function tagList(block: Block): string[] {
  const raw = block.props.tags;
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of raw) {
    if (typeof t !== "string") continue;
    const tag = t.trim().toLowerCase();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out;
}

/** Create an empty graph with the given node ids. */
export function emptyGraph(nodes: BlockId[]): WeightedGraph {
  const adj = new Map<BlockId, Map<BlockId, number>>();
  for (const id of nodes) adj.set(id, new Map());
  return { nodes: [...nodes], adj, totalWeight: 0 };
}

/** Weighted degree (sum of incident edge weights) of a node. */
export function weightedDegree(graph: WeightedGraph, id: BlockId): number {
  const nbrs = graph.adj.get(id);
  if (!nbrs) return 0;
  let sum = 0;
  for (const w of nbrs.values()) sum += w;
  return sum;
}

/** Weight of the edge between a and b (0 if none). */
export function edgeWeight(graph: WeightedGraph, a: BlockId, b: BlockId): number {
  return graph.adj.get(a)?.get(b) ?? 0;
}

/** Add `w` to the undirected edge {a,b} (creating it if needed). */
export function addEdge(graph: WeightedGraph, a: BlockId, b: BlockId, w: number): void {
  if (a === b || w <= 0) return;
  const na = graph.adj.get(a);
  const nb = graph.adj.get(b);
  if (!na || !nb) return;
  na.set(b, (na.get(b) ?? 0) + w);
  nb.set(a, (nb.get(a) ?? 0) + w);
  graph.totalWeight += w;
}

/**
 * Build a weighted adjacency graph from blocks. Deterministic: the same input
 * always yields the same graph.
 */
export function buildAdjacency(
  blocks: Block[],
  index?: EmbeddingIndex,
  options: AdjacencyOptions = {},
): WeightedGraph {
  const opts = { ...DEFAULT_ADJACENCY_OPTIONS, ...options };

  // Deduplicate blocks by id (first occurrence wins) so malformed input with
  // repeated ids can't produce duplicate nodes or double-counted edges.
  const known = new Set<BlockId>();
  const uniqueBlocks: Block[] = [];
  for (const block of blocks) {
    if (known.has(block.id)) continue;
    known.add(block.id);
    uniqueBlocks.push(block);
  }
  const ids = uniqueBlocks.map((b) => b.id);
  const graph = emptyGraph(ids);

  // wikilinks
  for (const block of uniqueBlocks) {
    for (const link of parseWikilinks(block.content)) {
      const target = resolveWikilink(link, uniqueBlocks);
      if (target && known.has(target)) addEdge(graph, block.id, target, opts.wikilinkWeight);
    }
  }

  // shared tags
  const byTag = new Map<string, BlockId[]>();
  for (const block of uniqueBlocks) {
    for (const tag of tagList(block)) {
      const arr = byTag.get(tag) ?? [];
      arr.push(block.id);
      byTag.set(tag, arr);
    }
  }
  for (const members of byTag.values()) {
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        addEdge(graph, members[i], members[j], opts.sharedTagWeight);
      }
    }
  }

  // hierarchy
  for (const block of uniqueBlocks) {
    if (block.parentId && known.has(block.parentId)) {
      addEdge(graph, block.id, block.parentId, opts.hierarchyWeight);
    }
  }

  // embedding kNN
  if (index && opts.knn > 0) {
    for (const id of ids) {
      const neighbours = index.nearest(id, opts.knn);
      for (const { id: other, score } of neighbours) {
        if (!known.has(other) || score < opts.minSimilarity) continue;
        addEdge(graph, id, other, score * opts.similarityWeight);
      }
    }
  }

  return graph;
}
