import type { Block } from "@atlas/contracts";

export interface SearchResult {
  /** Top-level page that owns the matching block (open target). */
  pageId: string;
  blockId: string;
  pageTitle: string;
  /** Text surrounding the first match. */
  snippet: string;
  /** Range of the first matched token within `snippet`. */
  matchStart: number;
  matchEnd: number;
  /** True when the match is in a page title (ranked first). */
  titleMatch: boolean;
}

const SNIPPET_RADIUS = 40;

function pageTitleOf(b: Block): string {
  const t = b.props.title;
  return typeof t === "string" && t.length > 0 ? t : b.content;
}

/** Walk parentId chain to the owning top-level page. */
function ownerPage(b: Block, byId: Map<string, Block>): Block | undefined {
  let cur: Block | undefined = b;
  const guard = new Set<string>();
  while (cur && cur.parentId !== null && !guard.has(cur.id)) {
    guard.add(cur.id);
    cur = byId.get(cur.parentId);
  }
  return cur;
}

function tokenize(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

/** All tokens must appear (case-insensitive substring) in `text`. */
function matchesAll(text: string, tokens: string[]): boolean {
  const lower = text.toLowerCase();
  return tokens.every((t) => lower.includes(t));
}

function makeSnippet(
  text: string,
  token: string,
): { snippet: string; matchStart: number; matchEnd: number } {
  const idx = text.toLowerCase().indexOf(token);
  if (idx < 0) {
    const snippet = text.slice(0, SNIPPET_RADIUS * 2);
    return { snippet, matchStart: 0, matchEnd: 0 };
  }
  const start = Math.max(0, idx - SNIPPET_RADIUS);
  const end = Math.min(text.length, idx + token.length + SNIPPET_RADIUS);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  const snippet = prefix + text.slice(start, end) + suffix;
  const matchStart = prefix.length + (idx - start);
  return { snippet, matchStart, matchEnd: matchStart + token.length };
}

/**
 * Case-insensitive full-text search over all pages and blocks.
 * Every whitespace-separated token must match; results are ranked with
 * page-title matches first, then content matches, most recent first within
 * each group.
 */
export function searchBlocks(
  blocks: Block[],
  query: string,
  limit = 20,
): SearchResult[] {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];

  const byId = new Map(blocks.map((b) => [b.id, b]));
  const titleHits: SearchResult[] = [];
  const contentHits: SearchResult[] = [];

  for (const b of blocks) {
    const page = ownerPage(b, byId);
    if (!page) continue;
    const pageTitle = pageTitleOf(page);

    if (b.type === "page" && matchesAll(pageTitleOf(b), tokens)) {
      const title = pageTitleOf(b);
      titleHits.push({
        pageId: b.id,
        blockId: b.id,
        pageTitle: title,
        ...makeSnippet(title, tokens[0]),
        titleMatch: true,
      });
      continue;
    }

    if (matchesAll(b.content, tokens)) {
      contentHits.push({
        pageId: page.id,
        blockId: b.id,
        pageTitle,
        ...makeSnippet(b.content, tokens[0]),
        titleMatch: false,
      });
    }
  }

  const byRecency = (a: SearchResult, z: SearchResult) =>
    (byId.get(z.blockId)?.updatedAt ?? 0) - (byId.get(a.blockId)?.updatedAt ?? 0);
  titleHits.sort(byRecency);
  contentHits.sort(byRecency);
  return [...titleHits, ...contentHits].slice(0, limit);
}
