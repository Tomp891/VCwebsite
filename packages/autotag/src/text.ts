/**
 * Local, dependency-free keyphrase extraction (YAKE-style) plus the shared
 * tokenizer used across @atlas/autotag. Fully deterministic — no network, no
 * randomness — so suggestions are reproducible in tests.
 *
 * Subagent (b) owns this file.
 */

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "for", "with",
  "as", "at", "by", "from", "into", "over", "is", "are", "was", "were", "be",
  "been", "being", "it", "its", "this", "that", "these", "those", "they", "them",
  "their", "so", "not", "no", "up", "out", "if", "then", "than", "each", "can",
  "will", "would", "should", "could", "may", "might", "must", "do", "does",
  "did", "has", "have", "had", "there", "here", "when", "where", "who", "what",
  "how", "why", "which", "while", "until", "about", "also", "more", "most",
  "some", "any", "all", "we", "you", "i", "he", "she", "our", "your", "my",
]);

/** A ranked keyphrase. `score` is 0..1 where higher means more salient. */
export interface Keyphrase {
  phrase: string;
  score: number;
}

/** Split text into lowercase alphanumeric tokens (words + numbers). */
export function tokenize(text: string): string[] {
  const matches = text.toLowerCase().match(/[a-z0-9]+/g);
  return matches ?? [];
}

/** Meaningful content tokens (stopwords + very short tokens removed). */
export function contentTokens(text: string): string[] {
  return tokenize(text).filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

/** True when a raw token is a stopword or too short to carry meaning. */
export function isStopword(token: string): boolean {
  return token.length <= 2 || STOPWORDS.has(token);
}

/**
 * Extract candidate keyphrases using a simplified, deterministic YAKE-style
 * scoring: single content words are scored by term-frequency and position
 * (earlier terms weigh slightly more); adjacent non-stopword bigrams are also
 * proposed. Returned best-first, scores normalised to 0..1.
 */
export function extractKeyphrases(text: string, limit = 6): Keyphrase[] {
  const rawTokens = tokenize(text);
  if (rawTokens.length === 0) return [];

  const freq = new Map<string, number>();
  const firstPos = new Map<string, number>();
  rawTokens.forEach((tok, i) => {
    if (isStopword(tok)) return;
    freq.set(tok, (freq.get(tok) ?? 0) + 1);
    if (!firstPos.has(tok)) firstPos.set(tok, i);
  });

  const n = rawTokens.length;
  const raw: Array<{ phrase: string; score: number }> = [];

  for (const [term, f] of freq) {
    const pos = firstPos.get(term) ?? 0;
    // position weight: earlier terms slightly favoured (1.0 -> ~0.7).
    const posWeight = 1 - (pos / Math.max(1, n)) * 0.3;
    raw.push({ phrase: term, score: f * posWeight * (1 + (term.length - 3) * 0.02) });
  }

  // adjacent non-stopword bigrams as multiword candidates.
  for (let i = 0; i < rawTokens.length - 1; i++) {
    const a = rawTokens[i];
    const b = rawTokens[i + 1];
    if (isStopword(a) || isStopword(b)) continue;
    const phrase = `${a} ${b}`;
    const posWeight = 1 - (i / Math.max(1, n)) * 0.3;
    raw.push({ phrase, score: 1.4 * posWeight });
  }

  if (raw.length === 0) return [];
  const max = raw.reduce((m, r) => Math.max(m, r.score), 0) || 1;
  raw.sort((x, y) => y.score - x.score || x.phrase.localeCompare(y.phrase));

  const seen = new Set<string>();
  const out: Keyphrase[] = [];
  for (const r of raw) {
    if (seen.has(r.phrase)) continue;
    seen.add(r.phrase);
    out.push({ phrase: r.phrase, score: r.score / max });
    if (out.length >= limit) break;
  }
  return out;
}
