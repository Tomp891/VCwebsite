/**
 * FROZEN CONTRACT — Emergent AI features.
 *
 * These interfaces are the boundary between the six emergent-AI workstreams so
 * they can be built in parallel without touching each other's files:
 *   1. embeddings   -> EmbeddingProvider + EmbeddingIndex
 *   2. clustering   -> Clusterer (communities / themes as partitions)
 *   3. ranking      -> Ranker (node importance)
 *   4. autotagging  -> AutoTagger (suggest-only tags)
 *   5. theme naming -> ThemeNamer (label + summarize a cluster)
 *   6. graph UX     -> EmergentGraphData (hulls/labels/temporal for rendering)
 *
 * Everything here is LOCAL / no-cost by default (deterministic mock fallbacks).
 * A real provider (Ollama / API) may implement EmbeddingProvider later with no
 * changes to consumers. Do not change these shapes without coordinating — every
 * emergent package depends on them.
 */

import type { Block, BlockId } from "./model.js";

/* ------------------------------------------------------------------ *
 * 1. Embeddings
 * ------------------------------------------------------------------ */

/** A dense vector plus the content hash it was computed from (for caching). */
export interface EmbeddingRecord {
  blockId: BlockId;
  /** hash of the text that produced `vector`; re-embed only when it changes. */
  hash: string;
  vector: number[];
  /** model/provider id, e.g. "mock-v1" | "nomic-embed-text". */
  model: string;
  updatedAt: number;
}

/** Pluggable text->vector provider. Mock is deterministic; Ollama/API optional. */
export interface EmbeddingProvider {
  readonly id: string;
  readonly dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
}

/**
 * Persisted, incremental embedding index. Only re-embeds blocks whose content
 * hash changed. Backed by IndexedDB in the app, in-memory in tests.
 */
export interface EmbeddingIndex {
  /** ensure every block has an up-to-date embedding; returns # (re)embedded. */
  sync(blocks: Block[]): Promise<number>;
  get(id: BlockId): EmbeddingRecord | undefined;
  all(): EmbeddingRecord[];
  /** cosine similarity to a block's neighbours, best first. */
  nearest(id: BlockId, k: number): Array<{ id: BlockId; score: number }>;
  similarity(a: BlockId, b: BlockId): number;
}

/* ------------------------------------------------------------------ *
 * 2. Clustering / community detection  (a theme is a cluster)
 * ------------------------------------------------------------------ */

export type ClusterMethod =
  | "louvain"
  | "leiden"
  | "kmeans"
  | "hdbscan"
  | "connected-components";

/** One detected community. Soft membership allowed via `memberships`. */
export interface Cluster {
  id: number;
  blockIds: BlockId[];
  /** cohesion 0..1 (e.g. modularity contribution or mean intra-similarity). */
  cohesion: number;
  /** most-central member, useful as a representative. */
  centroidBlockId?: BlockId;
}

/** Soft/multi-membership weight of a block in a cluster (0..1). */
export interface Membership {
  blockId: BlockId;
  clusterId: number;
  weight: number;
}

export interface ClusterResult {
  method: ClusterMethod;
  clusters: Cluster[];
  /** hard assignment convenience map. */
  assignment: Record<BlockId, number>;
  /** optional soft memberships (a block may appear in several). */
  memberships?: Membership[];
  /** overall partition quality, e.g. modularity 0..1. */
  quality: number;
}

export interface Clusterer {
  readonly method: ClusterMethod;
  cluster(blocks: Block[], index?: EmbeddingIndex): ClusterResult;
}

/* ------------------------------------------------------------------ *
 * 3. Ranking / centrality
 * ------------------------------------------------------------------ */

export type RankSignal = "pagerank" | "degree" | "recency" | "pin";

/** Importance score for one block, with a breakdown for provenance UI. */
export interface RankScore {
  blockId: BlockId;
  /** final blended score 0..1 -> node size. */
  score: number;
  /** per-signal contributions (already weighted), for "why" tooltips. */
  breakdown: Partial<Record<RankSignal, number>>;
}

export interface Ranker {
  rank(blocks: Block[]): RankScore[];
}

/* ------------------------------------------------------------------ *
 * 4. Autotagging (suggest-only, never auto-applied)
 * ------------------------------------------------------------------ */

export type TagSource = "existing-similarity" | "keyphrase" | "llm";

export interface TagSuggestion {
  blockId: BlockId;
  tag: string;
  confidence: number;
  source: TagSource;
  /** short human-readable justification. */
  reason: string;
}

export interface AutoTagger {
  suggest(block: Block, index?: EmbeddingIndex): Promise<TagSuggestion[]>;
}

/* ------------------------------------------------------------------ *
 * 5. Theme naming + summarization  (the "meaning" layer)
 * ------------------------------------------------------------------ */

/** A named, human-reviewable emergent theme derived from a Cluster. */
export interface Theme {
  clusterId: number;
  /** short serif-caps label, e.g. "Local-first Sync". */
  label: string;
  /** one-line summary of what the theme is about. */
  summary: string;
  keyphrases: string[];
  blockIds: BlockId[];
  /** representative block ids, most central first. */
  exemplars: BlockId[];
  confidence: number;
  /** provenance: how the label/summary were produced. */
  method: "keyphrase" | "llm" | "centroid-title";
  /** review state — themes are "pencil" until accepted, like edges. */
  status: "ambient" | "accepted" | "rejected" | "pinned";
}

export interface ThemeNamer {
  name(cluster: Cluster, blocks: Block[], index?: EmbeddingIndex): Promise<Theme>;
}

/* ------------------------------------------------------------------ *
 * 6. Emergent-graph UX data (consumed by 2D/3D renderers)
 * ------------------------------------------------------------------ */

/** A convex-hull region drawn behind a theme's nodes. */
export interface ThemeHull {
  clusterId: number;
  label: string;
  /** polygon points in graph space (renderer maps to screen). */
  points: Array<{ x: number; y: number }>;
  /** 0..1 -> hull opacity, from cohesion/confidence. */
  strength: number;
  status: Theme["status"];
}

/** Per-node emergent attributes layered onto the base GraphData nodes. */
export interface EmergentNodeAttrs {
  id: BlockId;
  rank: number;
  clusterId: number;
  /** soft memberships for multi-theme nodes. */
  memberships?: Array<{ clusterId: number; weight: number }>;
}

/**
 * Bundle the renderers read to draw emergent structure. This does NOT replace
 * the base GraphData contract — it augments it.
 */
export interface EmergentGraphData {
  themes: Theme[];
  hulls: ThemeHull[];
  nodeAttrs: Record<BlockId, EmergentNodeAttrs>;
  /** optional time-ordered snapshots for temporal-emergence playback. */
  timeline?: Array<{ t: number; assignment: Record<BlockId, number> }>;
}

/** Top-level façade the app wires once; each field is one workstream's output. */
export interface EmergentEngine {
  index: EmbeddingIndex;
  ranker: Ranker;
  clusterer: Clusterer;
  autoTagger: AutoTagger;
  themeNamer: ThemeNamer;
  /** compute the full emergent bundle for the current store. */
  compute(blocks: Block[]): Promise<EmergentGraphData>;
}
