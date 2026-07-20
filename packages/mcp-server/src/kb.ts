/**
 * In-memory knowledge base built from an Atlas export/live JSON payload.
 *
 * Pure, dependency-light (only the frozen @atlas/contracts types) so it can be
 * unit-tested without the MCP transport. Retrieval is fully local and
 * deterministic: lexical scoring (tf across the query terms, with an idf-style
 * rarity weight) plus one-hop graph expansion over the edge list. No model, no
 * network — the MCP client supplies the model.
 */
import type { Block, BlockId, Edge } from "@atlas/contracts";

/** The portable payload Atlas exports (blocks + edges; chat history ignored). */
export interface AtlasPayload {
  blocks: Block[];
  edges: Edge[];
}

export interface NoteHit {
  blockId: BlockId;
  pageId: BlockId;
  pageTitle: string;
  type: Block["type"];
  snippet: string;
  score: number;
}

export interface ContextResult {
  query: string;
  hits: NoteHit[];
  /** blockIds pulled in purely via graph adjacency (not direct text matches). */
  expandedFrom: BlockId[];
}

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "for", "is",
  "are", "was", "were", "be", "with", "as", "at", "by", "it", "this", "that",
  "from", "into", "over", "how", "what", "why", "when", "which", "who",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

function snippetOf(content: string, max = 160): string {
  const t = content.trim().replace(/\s+/g, " ");
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

export class KnowledgeBase {
  private readonly blocks: Block[];
  private readonly byId: Map<BlockId, Block>;
  private readonly tokensById: Map<BlockId, string[]>;
  /** document frequency per term, for idf-style rarity weighting. */
  private readonly df: Map<string, number>;
  /** undirected adjacency over all edges. */
  private readonly adj: Map<BlockId, Set<BlockId>>;
  readonly edges: Edge[];

  constructor(payload: AtlasPayload) {
    this.blocks = payload.blocks ?? [];
    this.edges = payload.edges ?? [];
    this.byId = new Map(this.blocks.map((b) => [b.id, b]));
    this.tokensById = new Map();
    this.df = new Map();
    for (const b of this.blocks) {
      const toks = tokenize(b.content);
      this.tokensById.set(b.id, toks);
      for (const t of new Set(toks)) this.df.set(t, (this.df.get(t) ?? 0) + 1);
    }
    this.adj = new Map();
    for (const e of this.edges) {
      this.link(e.srcBlockId, e.dstBlockId);
      this.link(e.dstBlockId, e.srcBlockId);
    }
  }

  private link(a: BlockId, b: BlockId): void {
    let set = this.adj.get(a);
    if (!set) {
      set = new Set();
      this.adj.set(a, set);
    }
    set.add(b);
  }

  get blockCount(): number {
    return this.blocks.length;
  }

  /** Title of the top-level page that owns `block` (walks the parent chain). */
  pageTitleFor(block: Block): { pageId: BlockId; title: string } {
    let cur: Block | undefined = block;
    const guard = new Set<BlockId>();
    while (cur && cur.parentId !== null && !guard.has(cur.id)) {
      guard.add(cur.id);
      const parent = this.byId.get(cur.parentId);
      if (!parent) break;
      cur = parent;
    }
    const page = cur ?? block;
    const t = page.props?.title;
    const title = typeof t === "string" && t.length > 0 ? t : page.content;
    return { pageId: page.id, title: snippetOf(title, 120) };
  }

  getBlock(id: BlockId): Block | undefined {
    return this.byId.get(id);
  }

  /** Lexical relevance of one block to a set of query terms. */
  private scoreBlock(id: BlockId, queryTerms: string[]): number {
    const toks = this.tokensById.get(id);
    if (!toks || toks.length === 0) return 0;
    const counts = new Map<string, number>();
    for (const t of toks) counts.set(t, (counts.get(t) ?? 0) + 1);
    const n = this.blocks.length || 1;
    let score = 0;
    for (const q of queryTerms) {
      const tf = counts.get(q);
      if (!tf) continue;
      const dfq = this.df.get(q) ?? 1;
      const idf = Math.log(1 + n / dfq);
      // length-normalized tf so long blocks don't dominate.
      score += (tf / toks.length) * idf;
    }
    return score;
  }

  /** Ranked lexical search over block content. */
  search(query: string, limit = 10): NoteHit[] {
    const terms = [...new Set(tokenize(query))];
    if (terms.length === 0) return [];
    const scored: NoteHit[] = [];
    for (const b of this.blocks) {
      const score = this.scoreBlock(b.id, terms);
      if (score <= 0) continue;
      const { pageId, title } = this.pageTitleFor(b);
      scored.push({
        blockId: b.id,
        pageId,
        pageTitle: title,
        type: b.type,
        snippet: snippetOf(b.content),
        score: Number(score.toFixed(4)),
      });
    }
    scored.sort((a, z) => z.score - a.score);
    return scored.slice(0, limit);
  }

  /** Neighboring blocks one hop away in the graph. */
  neighbors(id: BlockId): NoteHit[] {
    const set = this.adj.get(id);
    if (!set) return [];
    const out: NoteHit[] = [];
    for (const nid of set) {
      const b = this.byId.get(nid);
      if (!b) continue;
      const { pageId, title } = this.pageTitleFor(b);
      out.push({
        blockId: b.id,
        pageId,
        pageTitle: title,
        type: b.type,
        snippet: snippetOf(b.content),
        score: 0,
      });
    }
    return out;
  }

  /**
   * GraphRAG-style context: top lexical hits, then expanded with their direct
   * graph neighbors (deduped), so the client gets both the best matches and the
   * structurally-related notes around them.
   */
  retrieveContext(query: string, limit = 6, expand = true): ContextResult {
    const hits = this.search(query, limit);
    const seen = new Set(hits.map((h) => h.blockId));
    const expandedFrom: BlockId[] = [];
    if (expand) {
      for (const h of [...hits]) {
        for (const nb of this.neighbors(h.blockId)) {
          if (seen.has(nb.blockId)) continue;
          seen.add(nb.blockId);
          expandedFrom.push(nb.blockId);
          hits.push(nb);
        }
      }
    }
    return { query, hits, expandedFrom };
  }

  /** All distinct tags, most frequent first. */
  listTags(): { tag: string; count: number }[] {
    const counts = new Map<string, number>();
    const add = (tag: string): void => {
      const t = tag.replace(/^#/, "").trim();
      if (t) counts.set(t, (counts.get(t) ?? 0) + 1);
    };
    for (const b of this.blocks) {
      const tags = b.props?.tags;
      if (Array.isArray(tags)) for (const t of tags) if (typeof t === "string") add(t);
      for (const m of b.content.matchAll(/#([a-z0-9][a-z0-9-]*)/gi)) add(m[1]);
    }
    return [...counts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, z) => z.count - a.count);
  }

  /** High-level overview for the client to ground meta questions. */
  overview(): { pages: number; blocks: number; edges: number; tags: number } {
    const pages = this.blocks.filter((b) => b.type === "page").length;
    return {
      pages,
      blocks: this.blocks.length,
      edges: this.edges.length,
      tags: this.listTags().length,
    };
  }
}

/** Parse a raw JSON string into a validated AtlasPayload. */
export function parsePayload(raw: string): AtlasPayload {
  const data = JSON.parse(raw) as Partial<AtlasPayload>;
  if (!Array.isArray(data.blocks)) {
    throw new Error("Invalid Atlas payload: missing blocks[].");
  }
  return { blocks: data.blocks, edges: Array.isArray(data.edges) ? data.edges : [] };
}
