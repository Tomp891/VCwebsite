/**
 * Local, dependency-free keyphrase extraction (YAKE-style) plus the shared
 * tokenizer used across @atlas/autotag. Fully deterministic — no network, no
 * randomness — so suggestions are reproducible in tests.
 *
 * Autotagging is suggest-only: nothing here mutates a Block or applies a tag; it
 * only ranks candidate phrases so callers can propose them.
 *
 * Subagent (b) owns this file.
 */

/**
 * Shared stopword set for the whole package. Deliberately small and generic
 * (function words only) so it never suppresses domain vocabulary that might make
 * a good tag. Frozen to make its "shared, read-only" nature explicit.
 */
const STOPWORDS: ReadonlySet<string> = new Set([
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "for", "with",
  "as", "at", "by", "from", "into", "onto", "over", "under", "is", "are", "was",
  "were", "be", "been", "being", "am", "it", "its", "this", "that", "these",
  "those", "they", "them", "their", "theirs", "so", "not", "no", "nor", "up",
  "out", "off", "if", "then", "than", "each", "every", "either", "neither",
  "can", "cannot", "will", "wont", "would", "shall", "should", "could", "may",
  "might", "must", "do", "does", "did", "done", "doing", "has", "have", "had",
  "having", "there", "here", "when", "where", "who", "whom", "whose", "what",
  "how", "why", "which", "while", "until", "unless", "about", "also", "just",
  "more", "most", "less", "least", "much", "many", "some", "any", "all", "both",
  "few", "such", "own", "same", "very", "too", "we", "you", "i", "he", "she",
  "his", "her", "hers", "him", "our", "ours", "your", "yours", "my", "mine",
  "me", "us", "yourself", "myself", "itself", "themselves",
]);

/** A ranked keyphrase. `score` is 0..1 where higher means more salient. */
export interface Keyphrase {
  phrase: string;
  score: number;
}

const TOKEN_RE = /[a-z0-9]+/g;
/** Minimum length for a token to count as meaningful content. */
const MIN_CONTENT_LEN = 3;

/** Split text into lowercase alphanumeric tokens (words + numbers). */
export function tokenize(text: string): string[] {
  const matches = text.toLowerCase().match(TOKEN_RE);
  return matches ?? [];
}

/** Meaningful content tokens (stopwords + very short tokens removed). */
export function contentTokens(text: string): string[] {
  return tokenize(text).filter((t) => !isStopword(t));
}

/** True when a raw token is a stopword or too short to carry meaning. */
export function isStopword(token: string): boolean {
  return token.length < MIN_CONTENT_LEN || STOPWORDS.has(token);
}

/** Statistics derived from a single content term across the document. */
interface TermStats {
  /** Raw term frequency. */
  tf: number;
  /** Distinct immediate-left neighbours (any token). */
  left: Set<string>;
  /** Distinct immediate-right neighbours (any token). */
  right: Set<string>;
  /** Indices of the sentences the term appears in. */
  sentences: Set<number>;
}

/** Split raw text into sentences for positional / spread statistics. */
function splitSentences(text: string): string[] {
  return text
    .split(/[.!?\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Population standard deviation of a list of numbers. */
function stddev(values: number[], mean: number): number {
  if (values.length === 0) return 0;
  const variance =
    values.reduce((sum, v) => sum + (v - mean) * (v - mean), 0) / values.length;
  return Math.sqrt(variance);
}

/** Median of a numeric list (0 for an empty list). */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/** Gather per-term statistics needed by the YAKE-style scorer. */
function collectTermStats(sentences: string[]): Map<string, TermStats> {
  const stats = new Map<string, TermStats>();

  sentences.forEach((sentence, sentenceIdx) => {
    const tokens = tokenize(sentence);
    tokens.forEach((tok, i) => {
      if (isStopword(tok)) return;
      let entry = stats.get(tok);
      if (!entry) {
        entry = { tf: 0, left: new Set(), right: new Set(), sentences: new Set() };
        stats.set(tok, entry);
      }
      entry.tf += 1;
      entry.sentences.add(sentenceIdx);
      if (i > 0) entry.left.add(tokens[i - 1]);
      if (i < tokens.length - 1) entry.right.add(tokens[i + 1]);
    });
  });

  return stats;
}

/**
 * YAKE single-term weight (lower = more important). Combines position, term
 * frequency, contextual relatedness and sentence spread. The casing feature is
 * omitted because input is lower-cased, so it would be constant.
 */
function termWeight(
  stat: TermStats,
  meanTf: number,
  stdTf: number,
  maxTf: number,
  sentenceCount: number,
): number {
  const position = Math.log(Math.log(3 + median([...stat.sentences])));
  const frequency = stat.tf / (meanTf + stdTf || 1);
  const wdl = stat.left.size / stat.tf;
  const wdr = stat.right.size / stat.tf;
  const relatedness = 1 + (wdl + wdr) * (stat.tf / (maxTf || 1));
  const different = stat.sentences.size / (sentenceCount || 1);

  const denom = frequency / relatedness + different / relatedness;
  // Guard against a degenerate zero denominator (single-word documents).
  return (relatedness * position) / (denom || 1);
}

/**
 * Extract candidate keyphrases with a deterministic, dependency-free YAKE-style
 * scorer. Single content words are weighted by position, frequency, contextual
 * relatedness and sentence spread; adjacent non-stopword bigrams are proposed as
 * multiword candidates. Lower YAKE weights map to higher salience, so scores are
 * inverted and normalised to 0..1 (best-first), deduped and capped at `limit`.
 */
export function extractKeyphrases(text: string, limit = 6): Keyphrase[] {
  if (limit <= 0) return [];

  const sentences = splitSentences(text);
  const stats = collectTermStats(sentences);
  if (stats.size === 0) return [];

  const tfs = [...stats.values()].map((s) => s.tf);
  const meanTf = tfs.reduce((a, b) => a + b, 0) / tfs.length;
  const stdTf = stddev(tfs, meanTf);
  const maxTf = Math.max(...tfs);
  const sentenceCount = sentences.length;

  // Single-term YAKE weights (lower is better).
  const termScore = new Map<string, number>();
  for (const [term, stat] of stats) {
    termScore.set(
      term,
      termWeight(stat, meanTf, stdTf, maxTf, sentenceCount),
    );
  }

  // Candidate phrases keyed by phrase text -> YAKE weight (lower is better).
  const candidateWeight = new Map<string, number>();
  const setBest = (phrase: string, weight: number) => {
    const prev = candidateWeight.get(phrase);
    if (prev === undefined || weight < prev) candidateWeight.set(phrase, weight);
  };

  for (const [term, weight] of termScore) setBest(term, weight);

  // Adjacent non-stopword bigrams as multiword candidates.
  const bigramTf = new Map<string, number>();
  for (const sentence of sentences) {
    const tokens = tokenize(sentence);
    for (let i = 0; i < tokens.length - 1; i++) {
      const a = tokens[i];
      const b = tokens[i + 1];
      if (isStopword(a) || isStopword(b)) continue;
      bigramTf.set(`${a} ${b}`, (bigramTf.get(`${a} ${b}`) ?? 0) + 1);
    }
  }
  for (const [phrase, tf] of bigramTf) {
    const [a, b] = phrase.split(" ");
    const sa = termScore.get(a);
    const sb = termScore.get(b);
    if (sa === undefined || sb === undefined) continue;
    // YAKE n-gram weight: product of member weights damped by phrase frequency.
    const weight = (sa * sb) / (tf * (1 + sa + sb));
    setBest(phrase, weight);
  }

  // Convert weights (lower better) to salience (higher better) and normalise.
  const scored = [...candidateWeight].map(([phrase, weight]) => ({
    phrase,
    score: 1 / (1 + weight),
  }));
  const maxScore = scored.reduce((m, s) => Math.max(m, s.score), 0) || 1;

  scored.sort((x, y) => y.score - x.score || x.phrase.localeCompare(y.phrase));

  const out: Keyphrase[] = [];
  for (const s of scored) {
    out.push({ phrase: s.phrase, score: s.score / maxScore });
    if (out.length >= limit) break;
  }
  return out;
}
