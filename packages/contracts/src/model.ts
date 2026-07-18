/**
 * Atlas core data model — the single substrate.
 *
 * Everything is a Block. Pages are root Blocks. Databases are saved queries over
 * Block props. Graph nodes are Blocks; graph edges are Edges.
 *
 * This file is the FROZEN CONTRACT for the parallel build. Do not change shapes
 * without coordinating — every package depends on these types.
 */

export type BlockId = string;
export type EdgeId = string;

export type BlockType =
  | "page"
  | "text"
  | "heading"
  | "bullet"
  | "todo"
  | "quote"
  | "code";

export type PropValue = string | number | boolean | null | string[];

export interface Block {
  id: BlockId;
  /** null for root blocks (pages). */
  parentId: BlockId | null;
  /** sort order among siblings. */
  order: number;
  type: BlockType;
  /** raw markdown-ish text content of the block. */
  content: string;
  /** structured properties — powers databases and graph node attributes. */
  props: Record<string, PropValue>;
  createdAt: number;
  updatedAt: number;
}

/** Trust tier for edges — the manual(ink) vs AI(pencil) distinction. */
export type EdgeTier =
  | "explicit" // human-authored ink
  | "inferred_accepted" // AI-suggested, human-promoted to ink
  | "inferred_ambient"; // AI-only pencil, never used destructively

export type EdgeType =
  | "link" // [[wikilink]]
  | "ref" // block reference / transclusion
  | "tag"
  | "related" // AI similarity
  | "contradicts"
  | "supports"
  | "depends_on";

export interface EdgeProvenance {
  /** how this edge was derived. */
  method: "wikilink" | "tag" | "cosine" | "cooccurrence" | "llm" | "manual";
  /** free-form explanation shown as marginalia. */
  detail?: string;
}

export interface Edge {
  id: EdgeId;
  srcBlockId: BlockId;
  dstBlockId: BlockId;
  type: EdgeType;
  tier: EdgeTier;
  /** 0..1 confidence; 1 for explicit edges. */
  confidence: number;
  provenance: EdgeProvenance;
  createdAt: number;
}

/** Abstraction level for the multilayer graph (Z-axis in 3D). */
export type LayerKind = "atom" | "concept" | "domain";

export interface Layer {
  kind: LayerKind;
  /** block ids that live on this layer. */
  blockIds: BlockId[];
}
