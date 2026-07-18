/**
 * (b) Content hashing + block-text extraction for cache keying.
 *
 * The index only re-embeds a block when its *content hash* changes, so both the
 * text-extraction rule and the hash must be stable and deterministic.
 */

import type { Block } from "@atlas/contracts";

/**
 * The canonical text used to embed a block. Includes the block content plus any
 * string tags (they carry topical signal). Deterministic: tags are sorted so
 * reordering props never changes the hash.
 */
export function blockText(block: Block): string {
  const content = (block.content ?? "").trim();
  const rawTags = block.props?.tags;
  const tags = Array.isArray(rawTags)
    ? [...rawTags].filter((t): t is string => typeof t === "string").sort()
    : [];
  return tags.length > 0 ? `${content} ${tags.join(" ")}` : content;
}

/**
 * FNV-1a 32-bit hash rendered as 8-char hex. Fast, stable across runs, and has
 * no crypto/Node dependency so it works identically in the browser and tests.
 */
export function contentHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    // 32-bit FNV prime multiply via shifts to stay in 32-bit range.
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** Convenience: hash of a block's canonical embedding text. */
export function blockHash(block: Block): string {
  return contentHash(blockText(block));
}
