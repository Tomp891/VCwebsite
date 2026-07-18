/**
 * Existing-tag similarity recall: find tags used by the blocks most similar to
 * the target block. Uses an EmbeddingIndex when supplied (semantic recall);
 * otherwise falls back to a deterministic lexical overlap so the default path
 * stays local and no-cost.
 *
 * Autotagging is suggest-only: nothing here mutates a Block or applies a tag —
 * it only surfaces evidence-backed candidates. Fully deterministic (no network,
 * no randomness) so identical input always yields identical output.
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

/** A similar neighbour block with its (already non-negative) similarity. */
interface Neighbour {
  block: Block;
  score: number;
}

/**
 * The (deduped, cleaned) tags a block carries. `props.tags` is typed loosely
 * (`PropValue`), so validate defensively: keep only non-empty strings and
 * collapse duplicates while preserving first-seen order.
 */
function blockTags(b: Block): string[] {
  const raw = b.props.tags;
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of raw) {
    if (typeof value !== "string") continue;
    const tag = value.trim();
    if (tag.length === 0 || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out;
}

/** Clamp a raw similarity (e.g. cosine, which can be negative) into 0..1. */
function clampScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  if (score < 0) return 0;
  if (score > 1) return 1;
  return score;
}

/** Deterministic lexical similarity: Jaccard over content tokens (0..1). */
export function lexicalSimilarity(a: Block, b: Block): number {
  const sa = new Set(contentTokens(a.content));
  const sb = new Set(contentTokens(b.content));
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** Neighbours via the embedding index, best-first, self excluded, clamped. */
function indexNeighbours(
  block: Block,
  byId: Map<BlockId, Block>,
  index: EmbeddingIndex,
  k: number,
): Neighbour[] {
  return index
    .nearest(block.id, k)
    .filter((n) => n.id !== block.id)
    .map(({ id, score }) => {
      const nb = byId.get(id);
      return nb ? { block: nb, score: clampScore(score) } : undefined;
    })
    .filter((n): n is Neighbour => n !== undefined && n.score > 0);
}

/** Neighbours via deterministic lexical overlap, best-first, self excluded. */
function lexicalNeighbours(block: Block, blocks: Block[], k: number): Neighbour[] {
  return blocks
    .filter((b) => b.id !== block.id)
    .map((b) => ({ block: b, score: lexicalSimilarity(block, b) }))
    .filter((n) => n.score > 0)
    .sort((x, y) => y.score - x.score || x.block.id.localeCompare(y.block.id))
    .slice(0, k);
}

/**
 * Recall existing tags from the neighbours most similar to `block`. Aggregates
 * neighbour similarity per tag; a tag supported by several close neighbours
 * scores higher. Uses the `EmbeddingIndex` when it is provided and already
 * knows the target block, otherwise falls back to lexical overlap.
 *
 * Returns best-first with scores clamped to 0..1. Tags with no positive support
 * are never returned, and ties break by tag name for stable, deterministic
 * output.
 */
export function recallExistingTags(
  block: Block,
  blocks: Block[],
  index?: EmbeddingIndex,
  k = 5,
): TagRecall[] {
  const limit = Number.isFinite(k) && k > 0 ? Math.floor(k) : 1;
  const byId = new Map<BlockId, Block>(blocks.map((b) => [b.id, b]));

  const neighbours =
    index && index.get(block.id)
      ? indexNeighbours(block, byId, index, limit)
      : lexicalNeighbours(block, blocks, limit);

  const agg = new Map<string, { score: number; count: number }>();
  for (const { block: nb, score } of neighbours) {
    for (const tag of blockTags(nb)) {
      const cur = agg.get(tag) ?? { score: 0, count: 0 };
      cur.score += score;
      cur.count += 1;
      agg.set(tag, cur);
    }
  }

  const out: TagRecall[] = [];
  for (const [tag, { score, count }] of agg) {
    const norm = clampScore(score / limit);
    if (norm <= 0) continue;
    out.push({
      tag,
      score: norm,
      reason: `Used by ${count} similar note${count === 1 ? "" : "s"}`,
    });
  }
  out.sort((x, y) => y.score - x.score || x.tag.localeCompare(y.tag));
  return out;
}
