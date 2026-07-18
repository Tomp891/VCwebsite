/**
 * Lexical (BM25) scoring — a keyword channel to complement vector similarity.
 *
 * Pure vectors retrieve rare terms, ids, code tokens and proper nouns poorly;
 * BM25 gives an exact-term signal that is fused with cosine in the retriever.
 * Deterministic and dependency-free so it behaves identically in tests, the
 * browser, and under the mock provider.
 */
import type { BlockId } from "@atlas/contracts";

const WORD_RE = /[\p{L}\p{N}]+/gu;

/** Lowercase word tokens; shared by the query and every document. */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  const matches = text.toLowerCase().matchAll(WORD_RE);
  for (const m of matches) out.push(m[0]);
  return out;
}

export interface LexicalDoc {
  id: BlockId;
  text: string;
}

// Standard Okapi BM25 constants.
const K1 = 1.5;
const B = 0.75;

/**
 * BM25 score of every doc against the query, normalised to [0, 1] by the max
 * score (so it can be linearly blended with cosine). Docs with no query-term
 * overlap score 0.
 */
export function bm25Scores(query: string, docs: LexicalDoc[]): Map<BlockId, number> {
  const scores = new Map<BlockId, number>();
  if (docs.length === 0) return scores;

  const docTokens = docs.map((d) => tokenize(d.text));
  const lengths = docTokens.map((t) => t.length);
  const avgLen = lengths.reduce((a, b) => a + b, 0) / docs.length || 1;

  // Document frequency per term.
  const df = new Map<string, number>();
  docTokens.forEach((tokens) => {
    for (const t of new Set(tokens)) df.set(t, (df.get(t) ?? 0) + 1);
  });

  const queryTerms = [...new Set(tokenize(query))];
  const N = docs.length;

  let max = 0;
  docs.forEach((doc, i) => {
    const tokens = docTokens[i];
    const len = lengths[i];
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);

    let score = 0;
    for (const term of queryTerms) {
      const f = tf.get(term);
      if (!f) continue;
      const n = df.get(term) ?? 0;
      // BM25 idf with the +1 variant to keep it non-negative.
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      const denom = f + K1 * (1 - B + (B * len) / avgLen);
      score += idf * ((f * (K1 + 1)) / denom);
    }
    scores.set(doc.id, score);
    if (score > max) max = score;
  });

  if (max > 0) {
    for (const [id, s] of scores) scores.set(id, s / max);
  }
  return scores;
}
