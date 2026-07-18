/**
 * Tag normalization + dedupe against the existing taxonomy so suggestions reuse
 * the user's vocabulary instead of inventing near-duplicates ("graphs" vs
 * "graph", "Local First" vs "local-first").
 *
 * Subagent (d) owns this file.
 */

import type { Block } from "@atlas/contracts";

/**
 * Canonicalise a raw tag/keyphrase: lowercase, trim, collapse whitespace and
 * punctuation to single hyphens, and strip a naive plural "s".
 */
export function normalizeTag(raw: string): string {
  const base = raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return singularize(base);
}

/** Naive singularization for the final word segment ("graphs" -> "graph"). */
function singularize(tag: string): string {
  if (tag.length <= 4) return tag;
  if (tag.endsWith("ies")) return `${tag.slice(0, -3)}y`;
  if (tag.endsWith("sses")) return tag.slice(0, -2);
  if (tag.endsWith("s") && !tag.endsWith("ss")) return tag.slice(0, -1);
  return tag;
}

/** Unique, normalized set of tags already used across the given blocks. */
export function buildTaxonomy(blocks: Block[]): string[] {
  const seen = new Set<string>();
  for (const b of blocks) {
    const tags = (b.props.tags as string[] | undefined) ?? [];
    for (const t of tags) {
      const norm = normalizeTag(t);
      if (norm) seen.add(norm);
    }
  }
  return [...seen].sort();
}

export interface DedupeResult {
  /** the tag to present (canonical form if it maps onto the taxonomy). */
  tag: string;
  /** matched existing taxonomy entry, or null when this is a new tag. */
  canonical: string | null;
  isNew: boolean;
}

/**
 * Map a candidate onto the taxonomy. Exact normalized match -> reuse it; near
 * match (one contains the other) -> reuse the existing entry; else it is new.
 */
export function dedupeAgainstTaxonomy(
  candidate: string,
  taxonomy: string[],
): DedupeResult {
  const norm = normalizeTag(candidate);
  if (!norm) return { tag: "", canonical: null, isNew: false };

  if (taxonomy.includes(norm)) {
    return { tag: norm, canonical: norm, isNew: false };
  }
  for (const existing of taxonomy) {
    if (existing.includes(norm) || norm.includes(existing)) {
      return { tag: existing, canonical: existing, isNew: false };
    }
  }
  return { tag: norm, canonical: null, isNew: true };
}
