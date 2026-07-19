/**
 * Tag helpers. Tags live on `Block.props.tags` (array of lowercase strings) and
 * power the nav filter, graph filter, and database views.
 */
import type { PropValue } from "@atlas/contracts";

/** `#hashtag` occurrences in free text, lowercased and de-duped. */
const HASHTAG_RE = /(?:^|\s)#([a-z0-9][a-z0-9_-]*)/gi;

export function extractHashtags(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  HASHTAG_RE.lastIndex = 0;
  while ((m = HASHTAG_RE.exec(text)) !== null) {
    const tag = m[1].toLowerCase();
    if (!seen.has(tag)) {
      seen.add(tag);
      out.push(tag);
    }
  }
  return out;
}

/** The `tags` prop read as a clean string array. */
export function blockTagList(props: Record<string, PropValue>): string[] {
  const raw = props.tags;
  return Array.isArray(raw) ? raw.filter((t): t is string => typeof t === "string") : [];
}

/** Normalize a user-entered tag: strip leading '#', trim, lowercase. */
export function normalizeTag(tag: string): string {
  return tag.trim().replace(/^#+/, "").toLowerCase();
}

/** Union of tag lists preserving first-seen order. */
export function unionTags(...lists: string[][]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const list of lists) {
    for (const t of list) {
      if (t && !seen.has(t)) {
        seen.add(t);
        out.push(t);
      }
    }
  }
  return out;
}
