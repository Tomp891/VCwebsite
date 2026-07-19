/**
 * (b) Content hashing + block-text extraction for cache keying.
 *
 * The index only re-embeds a block when its *content hash* changes, so both the
 * text-extraction rule and the hash must be stable and deterministic. Everything
 * here is pure and dependency-free (no crypto/Node APIs) so it produces byte-for-
 * byte identical results in the browser, in tests, and across runs.
 */

import type { Block, PropValue } from "@atlas/contracts";

/** Separates the content section from the tag section in the canonical text. */
const TAG_SECTION_SEPARATOR = "\n";
/** Separates individual tags within the tag section. */
const TAG_JOINER = " ";

/**
 * Read a block's raw tags defensively. `props` (and `props.tags`) may be
 * missing or malformed on partial/hand-authored blocks, so never assume shape.
 */
function readTags(block: Block): readonly PropValue[] {
  const props = block?.props;
  if (props == null || typeof props !== "object") return [];
  const rawTags = (props as Record<string, unknown>).tags;
  return Array.isArray(rawTags) ? (rawTags as PropValue[]) : [];
}

/**
 * Canonicalise tags: keep only non-empty strings, trim them, de-duplicate, and
 * sort. Sorting makes the result independent of prop ordering; de-duping keeps
 * repeated tags from perturbing the text (and the hash).
 */
function canonicalTags(block: Block): string[] {
  const seen = new Set<string>();
  for (const tag of readTags(block)) {
    if (typeof tag !== "string") continue;
    const trimmed = tag.trim();
    if (trimmed.length === 0) continue;
    seen.add(trimmed);
  }
  return [...seen].sort();
}

/**
 * The canonical text used to embed a block. Includes the block content plus any
 * string tags (they carry topical signal).
 *
 * Deterministic and hardened: content is coerced to a string and trimmed, tags
 * are trimmed / de-duped / sorted (so reordering props never changes the hash),
 * and the two sections are joined with a fixed separator so `content` and `tags`
 * can never bleed into each other (e.g. content "a b" with no tags is distinct
 * from content "a" with tag "b").
 */
export function blockText(block: Block): string {
  const rawContent = block?.content;
  const content = typeof rawContent === "string" ? rawContent.trim() : "";
  const tags = canonicalTags(block);
  if (tags.length === 0) return content;
  return `${content}${TAG_SECTION_SEPARATOR}${tags.join(TAG_JOINER)}`;
}

/**
 * FNV-1a 32-bit hash rendered as 8-char hex. Fast, stable across runs, and has
 * no crypto/Node dependency so it works identically in the browser and tests.
 *
 * Iterates UTF-16 code units, which is deterministic for any string length, so
 * arbitrarily long content hashes safely. Non-string input is coerced so a
 * malformed caller can never throw here.
 */
export function contentHash(text: string): string {
  const s = typeof text === "string" ? text : String(text ?? "");
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    // 32-bit FNV prime multiply via shifts to stay in 32-bit range.
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** Convenience: hash of a block's canonical embedding text. */
export function blockHash(block: Block): string {
  return contentHash(blockText(block));
}
