/**
 * Lightweight, dependency-free text utilities shared by the mock provider and
 * the suggester (tokenization, stopword filtering, keyword extraction).
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
export function tokenize(text: string): string[] {
  const matches = text.toLowerCase().match(/[a-z0-9]+/g);
  return matches ?? [];
}

/** Meaningful content tokens (stopwords + very short tokens removed). */
export function contentTokens(text: string): string[] {
  return tokenize(text).filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

/** Content tokens shared by two texts, ranked by combined frequency. */
export function sharedTerms(a: string, b: string): string[] {
  const countsA = termCounts(a);
  const countsB = termCounts(b);
  const shared: Array<{ term: string; score: number }> = [];
  for (const [term, ca] of countsA) {
    const cb = countsB.get(term);
    if (cb !== undefined) shared.push({ term, score: ca + cb });
  }
  shared.sort((x, y) => y.score - x.score || x.term.localeCompare(y.term));
  return shared.map((s) => s.term);
}

/** Top keyword tags for a text, ranked by frequency then length. */
export function keywords(text: string, limit = 5): string[] {
  const counts = [...termCounts(text)];
  counts.sort((x, y) => y[1] - x[1] || y[0].length - x[0].length || x[0].localeCompare(y[0]));
  return counts.slice(0, limit).map(([term]) => term);
}

function termCounts(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const t of contentTokens(text)) {
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return counts;
}
