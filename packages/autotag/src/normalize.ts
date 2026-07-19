/**
 * Tag normalization + dedupe against the existing taxonomy so suggestions reuse
 * the user's vocabulary instead of inventing near-duplicates ("graphs" vs
 * "graph", "Local First" vs "local-first").
 *
 * Suggest-only: nothing here mutates a Block. Everything is deterministic and
 * local (no network, no randomness) so the same input always yields the same
 * output.
 *
 * Subagent (d) owns this file.
 */

import type { Block } from "@atlas/contracts";

/**
 * Canonicalise a raw tag/keyphrase into a slug:
 *  - lowercase + trim
 *  - fold diacritics ("café" -> "cafe") so accents don't fork the taxonomy
 *  - collapse every run of non-alphanumeric characters into a single hyphen
 *  - strip leading/trailing hyphens
 *  - naively singularize the final segment ("knowledge-graphs" -> "knowledge-graph")
 *
 * Returns "" for input that has no alphanumeric content.
 */
export function normalizeTag(raw: string): string {
  const slug = foldDiacritics(raw.toLowerCase())
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) return "";

  const segments = slug.split("-");
  const last = segments.length - 1;
  segments[last] = singularize(segments[last]);
  return segments.join("-");
}

/** Strip combining diacritical marks via Unicode NFKD decomposition. */
function foldDiacritics(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Naive singularization of a single word segment ("graphs" -> "graph",
 * "categories" -> "category"). Short words are left untouched to avoid
 * butchering acronyms/roots.
 */
function singularize(segment: string): string {
  if (segment.length <= 4) return segment;
  if (segment.endsWith("ies")) return `${segment.slice(0, -3)}y`;
  if (segment.endsWith("sses")) return segment.slice(0, -2);
  if (segment.endsWith("ss")) return segment;
  if (segment.endsWith("s")) return segment.slice(0, -1);
  return segment;
}

/** Type-safe extraction of a block's tags (props.tags is `string[] | undefined`). */
function tagsOf(block: Block): string[] {
  const tags = block.props.tags;
  return Array.isArray(tags) ? tags : [];
}

/**
 * The unique, normalized, alphabetically-sorted set of tags already used across
 * the given blocks — the vocabulary new suggestions should snap onto.
 */
export function buildTaxonomy(blocks: Block[]): string[] {
  const seen = new Set<string>();
  for (const block of blocks) {
    for (const tag of tagsOf(block)) {
      const norm = normalizeTag(tag);
      if (norm) seen.add(norm);
    }
  }
  return [...seen].sort();
}

export interface DedupeResult {
  /** the tag to present (canonical form when it maps onto the taxonomy). */
  tag: string;
  /** matched existing taxonomy entry, or null when this is a new tag. */
  canonical: string | null;
  isNew: boolean;
}

/**
 * Map a candidate tag onto the existing taxonomy:
 *  - exact normalized match  -> reuse it
 *  - near match (one is a hyphen-boundary sub-slug of the other, e.g.
 *    "graph" vs "knowledge-graph") -> reuse the existing entry
 *  - otherwise               -> a genuinely new tag
 *
 * When several taxonomy entries are near matches, the closest one (smallest
 * length difference, then alphabetical) is chosen so the result is
 * deterministic. Never mutates anything.
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

  let best: string | null = null;
  for (const existing of taxonomy) {
    if (!isNearMatch(norm, existing)) continue;
    if (best === null || isCloserMatch(norm, existing, best)) {
      best = existing;
    }
  }

  if (best !== null) {
    return { tag: best, canonical: best, isNew: false };
  }
  return { tag: norm, canonical: null, isNew: true };
}

/**
 * True when one slug is contained in the other on hyphen boundaries, e.g.
 * "graph" ⊂ "knowledge-graph" but not "graph" ⊂ "graphite" (that would already
 * be a distinct normalized slug anyway). Guards against trivial single-segment
 * substrings that aren't real relatives.
 */
function isNearMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  const segments = longer.split("-");
  const window = shorter.split("-").length;
  for (let i = 0; i + window <= segments.length; i++) {
    if (segments.slice(i, i + window).join("-") === shorter) return true;
  }
  return false;
}

/** Prefer the taxonomy entry closest in length, breaking ties alphabetically. */
function isCloserMatch(norm: string, candidate: string, current: string): boolean {
  const dCandidate = Math.abs(candidate.length - norm.length);
  const dCurrent = Math.abs(current.length - norm.length);
  if (dCandidate !== dCurrent) return dCandidate < dCurrent;
  return candidate < current;
}
