/**
 * (b) Keyphrase extraction + serif-caps label for a theme.
 *
 * Deterministic, dependency-free. Keyphrases are the cluster's most salient
 * content terms/bigrams; the label is a short, Title-Cased string built from
 * the top keyphrases (the app renders it in a serif face — see contract).
 */

import type { Block } from "@atlas/contracts";

/**
 * Local stopword list + tokenizer, replicated inline to avoid a cross-package
 * import (reference: packages/ai/src/text.ts).
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
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

/** Meaningful content tokens (stopwords + very short tokens removed). */
function contentTokens(text: string): string[] {
  return tokenize(text).filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

interface Candidate {
  /** the (lowercase) phrase text. */
  term: string;
  /** frequency / co-occurrence count. */
  score: number;
  /** whether the candidate is a bigram (vs. a unigram). */
  bigram: boolean;
}

/**
 * Extract up to `limit` salient keyphrases for a set of cluster blocks,
 * most-salient first.
 *
 * Deterministic, dependency-free, YAKE-flavoured: score stopword-filtered
 * unigrams by frequency and bigrams (adjacent content tokens) by co-occurrence.
 * Multi-word phrases win ties so they surface ahead of their component words,
 * and any unigram already covered by a chosen bigram is dropped. Ordering is
 * stable: score desc, bigrams before unigrams, then term asc.
 */
export function extractKeyphrases(blocks: Block[], limit = 5): string[] {
  if (limit <= 0) return [];

  const unigrams = new Map<string, number>();
  const bigrams = new Map<string, number>();

  for (const b of blocks) {
    const tokens = contentTokens(b.content);
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      unigrams.set(t, (unigrams.get(t) ?? 0) + 1);
      if (i + 1 < tokens.length) {
        const phrase = `${t} ${tokens[i + 1]}`;
        bigrams.set(phrase, (bigrams.get(phrase) ?? 0) + 1);
      }
    }
  }

  const candidates: Candidate[] = [];
  for (const [term, score] of bigrams) {
    candidates.push({ term, score, bigram: true });
  }
  for (const [term, score] of unigrams) {
    candidates.push({ term, score, bigram: false });
  }

  candidates.sort(
    (a, b) =>
      b.score - a.score ||
      Number(b.bigram) - Number(a.bigram) ||
      a.term.localeCompare(b.term),
  );

  const covered = new Set<string>();
  const out: string[] = [];
  for (const c of candidates) {
    if (out.length >= limit) break;
    if (c.bigram) {
      const [first, second] = c.term.split(" ");
      covered.add(first);
      covered.add(second);
      out.push(c.term);
    } else if (!covered.has(c.term)) {
      covered.add(c.term);
      out.push(c.term);
    }
  }

  return out;
}

/** Build a short serif-caps (Title Case) label from keyphrases. */
export function buildLabel(keyphrases: string[], blocks: Block[]): string {
  const source = keyphrases.length ? keyphrases : extractKeyphrases(blocks);

  const words: string[] = [];
  const seen = new Set<string>();
  for (const phrase of source) {
    const parts = phrase.split(/\s+/).filter((w) => w && !seen.has(w));
    if (parts.length === 0) continue;
    if (words.length > 0 && words.length + parts.length > 3) break;
    for (const w of parts) {
      words.push(w);
      seen.add(w);
    }
    if (words.length >= 3) break;
  }

  const label = serifCaps(words.join(" "));
  return label || "Untitled Theme";
}

/** Title-case a single token/phrase (serif-caps styling is applied in CSS). */
export function serifCaps(s: string): string {
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
