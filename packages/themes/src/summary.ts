/**
 * (c) One-line extractive summary of a theme.
 *
 * Local/extractive only — no generation. Picks the single most representative
 * sentence from the cluster's blocks (preferring the pre-ranked exemplars),
 * scoring candidates by how well they cover the cluster's salient content
 * terms, then trims the winner to one clean line.
 */

import type { Block, BlockId, Cluster } from "@atlas/contracts";

/**
 * Stopword list + tokenizer mirrored (intentionally, not imported) from
 * packages/ai/src/text.ts to keep this slice self-contained and cross-package
 * dependency-free.
 */
const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "for", "with",
  "as", "at", "by", "from", "into", "over", "is", "are", "was", "were", "be",
  "been", "being", "it", "its", "this", "that", "these", "those", "they", "them",
  "their", "so", "not", "no", "up", "out", "if", "then", "than", "each", "can",
  "will", "user", "users", "keep", "create", "creates", "make", "makes", "place",
  "places", "near", "other", "which", "while", "until", "combines", "separates",
  "connect", "connects", "enable", "enables",
]);

/** Split text into lowercase alphanumeric tokens (words + numbers). */
function tokenize(text: string): string[] {
  const matches = text.toLowerCase().match(/[a-z0-9]+/g);
  return matches ?? [];
}

/** Meaningful content tokens (stopwords + very short tokens removed). */
function contentTokens(text: string): string[] {
  return tokenize(text).filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

interface Candidate {
  sentence: string;
  score: number;
  /** rank in the exemplar list (lower = more central); Infinity if not one. */
  exemplarRank: number;
  blockId: BlockId;
  /** position of the sentence within its block. */
  position: number;
}

/**
 * Produce a one-line summary for a cluster. `exemplars` are the pre-ranked
 * representative block ids (most-central first). The single sentence that best
 * covers the cluster's salient content terms is returned, preferring exemplars
 * and breaking ties deterministically (exemplar order, blockId, position).
 */
export function summarize(
  cluster: Cluster,
  blocks: Block[],
  exemplars: BlockId[],
): string {
  if (cluster.blockIds.length === 0) return "";

  const byId = new Map(blocks.map((b) => [b.id, b] as const));
  const memberIds = cluster.blockIds.filter((id) => byId.has(id));
  if (memberIds.length === 0) return "";

  // Salience: content-term frequencies across the whole cluster.
  const salience = new Map<string, number>();
  for (const id of memberIds) {
    for (const term of contentTokens(byId.get(id)?.content ?? "")) {
      salience.set(term, (salience.get(term) ?? 0) + 1);
    }
  }

  const exemplarRankById = new Map<BlockId, number>();
  exemplars.forEach((id, i) => {
    if (!exemplarRankById.has(id)) exemplarRankById.set(id, i);
  });

  let best: Candidate | undefined;
  for (const id of memberIds) {
    const exemplarRank = exemplarRankById.get(id) ?? Number.POSITIVE_INFINITY;
    const sentences = splitSentences(byId.get(id)?.content ?? "");
    sentences.forEach((sentence, position) => {
      const candidate: Candidate = {
        sentence,
        score: scoreSentence(sentence, salience),
        exemplarRank,
        blockId: id,
        position,
      };
      if (best === undefined || isBetter(candidate, best)) best = candidate;
    });
  }

  return best ? firstSentence(best.sentence) : "";
}

/** First sentence of a text, collapsed to a single trimmed line. */
export function firstSentence(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  const match = oneLine.match(/^.*?[.!?](?=\s|$)/);
  return (match ? match[0] : oneLine).trim();
}

/** Coverage of the cluster's salient terms: sum of frequencies of the
 * distinct content terms the sentence contains. */
function scoreSentence(sentence: string, salience: Map<string, number>): number {
  let score = 0;
  const seen = new Set<string>();
  for (const term of contentTokens(sentence)) {
    if (seen.has(term)) continue;
    seen.add(term);
    score += salience.get(term) ?? 0;
  }
  return score;
}

/** Deterministic ordering: higher score first, then exemplar order, then
 * blockId, then earlier sentence position. */
function isBetter(a: Candidate, b: Candidate): boolean {
  if (a.score !== b.score) return a.score > b.score;
  if (a.exemplarRank !== b.exemplarRank) return a.exemplarRank < b.exemplarRank;
  if (a.blockId !== b.blockId) return a.blockId.localeCompare(b.blockId) < 0;
  return a.position < b.position;
}

/** Split text into trimmed sentences, preserving terminating punctuation. */
function splitSentences(text: string): string[] {
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (!oneLine) return [];
  const matches = oneLine.match(/[^.!?]+(?:[.!?]+|$)/g);
  return (matches ?? [oneLine]).map((s) => s.trim()).filter((s) => s.length > 0);
}
