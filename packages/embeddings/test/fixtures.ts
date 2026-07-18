/**
 * (f) Shared test fixtures. Built on the frozen mock blocks from @atlas/contracts
 * plus a couple of edited/new variants used to exercise incremental sync.
 */

import type { Block } from "@atlas/contracts";
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
