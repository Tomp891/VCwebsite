/**
 * (c) One-line extractive summary of a theme.
 *
 * Local/extractive only — no generation. Picks the single most representative
 * sentence from the cluster's exemplar blocks (falling back to the centroid),
 * trims it to one clean line, and returns it as the theme summary.
 */

import type { Block, BlockId, Cluster } from "@atlas/contracts";

/**
 * Produce a one-line summary for a cluster. `exemplars` are the pre-ranked
 * representative block ids (see selectExemplars); the first available block's
 * leading sentence is used as the extractive summary.
 */
export function summarize(
  cluster: Cluster,
  blocks: Block[],
  exemplars: BlockId[],
): string {
  const byId = new Map(blocks.map((b) => [b.id, b] as const));
  const ordered = [...exemplars, ...cluster.blockIds];
  for (const id of ordered) {
    const text = byId.get(id)?.content?.trim();
    if (text) return firstSentence(text);
  }
  return "";
}

/** First sentence of a text, collapsed to a single trimmed line. */
export function firstSentence(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  const match = oneLine.match(/^.*?[.!?](?=\s|$)/);
  return (match ? match[0] : oneLine).trim();
}
