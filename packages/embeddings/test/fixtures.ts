/**
 * (f) Shared test fixtures. Built on the frozen mock blocks from @atlas/contracts
 * plus a few edited/new variants used to exercise incremental sync, plus small
 * hand-authored text corpora for provider/cosine assertions.
 */

import type { Block, BlockId } from "@atlas/contracts";
import { mockBlocks } from "@atlas/contracts";

export { mockBlocks };

/** Return a deep-ish copy so tests can mutate freely. */
export function cloneBlocks(): Block[] {
  return mockBlocks.map((b) => ({ ...b, props: { ...b.props } }));
}

/** A block whose content differs from the fixture with the same id. */
export function editContent(blocks: Block[], id: string, content: string): Block[] {
  return blocks.map((b) => (b.id === id ? { ...b, content } : b));
}

/** Replace the tags prop of the block with the given id. */
export function editTags(blocks: Block[], id: string, tags: string[]): Block[] {
  return blocks.map((b) => (b.id === id ? { ...b, props: { ...b.props, tags } } : b));
}

/** Remove the block(s) with the given id(s). */
export function removeBlocks(blocks: Block[], ...ids: BlockId[]): Block[] {
  const drop = new Set(ids);
  return blocks.filter((b) => !drop.has(b.id));
}

/**
 * Build a standalone block with sensible defaults. Handy for constructing tiny,
 * fully-controlled corpora without depending on the shape of mockBlocks.
 */
export function makeBlock(
  id: string,
  content: string,
  tags: string[] = [],
): Block {
  return {
    id,
    parentId: null,
    order: 0,
    type: "text",
    content,
    props: tags.length > 0 ? { tags } : {},
    createdAt: 0,
    updatedAt: 0,
  };
}

/** Append a freshly-built block to a copy of `blocks`. */
export function addBlock(
  blocks: Block[],
  id: string,
  content: string,
  tags: string[] = [],
): Block[] {
  return [...blocks, makeBlock(id, content, tags)];
}

/**
 * A minimal corpus for provider/similarity assertions: two clearly-related
 * sentences (heavy token overlap) and one unrelated sentence. Deterministic and
 * self-contained so similarity ordering is stable regardless of mock data.
 */
export const relatedTexts = {
  a: "Knowledge graphs connect atomic notes into a navigable structure.",
  b: "Knowledge graphs connect notes into a navigable graph structure.",
  unrelated: "Local-first apps keep data as plain files the user owns.",
} as const;

/** Texts that share no alphanumeric tokens — used for orthogonality checks. */
export const disjointTexts = {
  a: "alpha beta gamma delta",
  b: "epsilon zeta eta theta",
} as const;
