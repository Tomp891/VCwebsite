/**
 * Existing-tag similarity recall: find tags used by the blocks most similar to
 * the target block. Uses an EmbeddingIndex when supplied (semantic recall);
 * otherwise falls back to a deterministic lexical overlap so the default path
 * stays local and no-cost.
 *
 * Subagent (a) owns this file.
 */

import type { Block, BlockId, EmbeddingIndex } from "@atlas/contracts";
import { contentTokens } from "./text.js";

/** A recalled existing tag with the neighbour evidence behind it. */
export interface TagRecall {
  tag: string;
  /** aggregated 0..1 support from similar neighbours. */
  score: number;
  reason: string;
}

function blockTags(b: Block): string[] {
  return (b.props.tags as string[] | undefined) ?? [];
}

/** Deterministic lexical similarity: Jaccard over content tokens (0..1). */
export function lexicalSimilarity(a: Block, b: Block): number {
  const sa = new Set(contentTokens(a.content));
  const sb = new Set(contentTokens(b.content));
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  return inter / (sa.size + sb.size - inter);
}

/**
 * Recall existing tags from the neighbours most similar to `block`. Aggregates
 * neighbour similarity per tag; a tag supported by several close neighbours
 * scores higher. Returns best-first, scores clamped to 0..1.
 */
export function recallExistingTags(
  block: Block,
  blocks: Block[],
  index?: EmbeddingIndex,
  k = 5,
): TagRecall[] {
  const byId = new Map<BlockId, Block>(blocks.map((b) => [b.id, b]));

  let neighbours: Array<{ block: Block; score: number }> = [];
  if (index && index.get(block.id)) {
    neighbours = index
      .nearest(block.id, k)
      .map(({ id, score }) => ({ block: byId.get(id), score }))
      .filter((n): n is { block: Block; score: number } => n.block !== undefined);
  } else {
    neighbours = blocks
      .filter((b) => b.id !== block.id)
      .map((b) => ({ block: b, score: lexicalSimilarity(block, b) }))
      .filter((n) => n.score > 0)
      .sort((x, y) => y.score - x.score)
      .slice(0, k);
  }

  const agg = new Map<string, { score: number; count: number }>();
  for (const { block: nb, score } of neighbours) {
    for (const tag of blockTags(nb)) {
      const cur = agg.get(tag) ?? { score: 0, count: 0 };
      cur.score += Math.max(0, score);
      cur.count += 1;
      agg.set(tag, cur);
    }
  }

  const out: TagRecall[] = [];
  for (const [tag, { score, count }] of agg) {
    const norm = Math.min(1, score / k);
    out.push({
      tag,
      score: norm,
      reason: `Used by ${count} similar note${count === 1 ? "" : "s"}`,
    });
  }
  out.sort((x, y) => y.score - x.score || x.tag.localeCompare(y.tag));
  return out;
}
