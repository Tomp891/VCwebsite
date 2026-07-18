/** Parse and match [[wikilink]] targets out of block content. */

const WIKILINK_RE = /\[\[([^[\]]+)\]\]/g;

/** Extract the trimmed, de-duplicated link texts from a block's content. */
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

/** A human-facing title for a block: its `title` prop if set, else its content. */
export function blockTitle(block: { content: string; props: Record<string, unknown> }): string {
  const title = block.props.title;
  if (typeof title === "string" && title.trim()) return title.trim();
  return block.content.trim();
}

/**
 * Resolve a wikilink text to the id of the first block whose title/content
 * starts with the link text (case-insensitive). Returns undefined if none match.
 */
export function resolveWikilink(
  linkText: string,
  blocks: Array<{ id: string; content: string; props: Record<string, unknown> }>,
): string | undefined {
  const needle = linkText.trim().toLowerCase();
  if (!needle) return undefined;
  for (const block of blocks) {
    if (blockTitle(block).toLowerCase().startsWith(needle)) return block.id;
  }
  return undefined;
}
