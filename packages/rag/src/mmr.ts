/**
 * Maximal Marginal Relevance (MMR) selection.
 *
 * Top-K by raw relevance floods the context with near-duplicate blocks. MMR
 * greedily picks items that are relevant to the query yet dissimilar to what is
 * already selected, trading a little relevance for coverage:
 *   score = λ·relevance − (1−λ)·maxSimToSelected
 * λ=1 collapses to pure relevance; lower λ favours diversity.
 */
import { cosine } from "./cosine.js";

export interface MmrCandidate<T> {
  item: T;
  relevance: number;
  vector: number[];
}

export function mmrSelect<T>(
  candidates: MmrCandidate<T>[],
  k: number,
  lambda: number,
): T[] {
  const n = Math.min(k, candidates.length);
  if (n <= 0) return [];
  // λ=1 (or a single pick) is plain relevance ordering — skip the O(k·n) work.
  if (lambda >= 1 || n === candidates.length) {
    return [...candidates]
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, n)
      .map((c) => c.item);
  }

  const pool = [...candidates].sort((a, b) => b.relevance - a.relevance);
  const selected: MmrCandidate<T>[] = [];
  // Seed with the single most relevant candidate.
  selected.push(pool.shift() as MmrCandidate<T>);

  while (selected.length < n && pool.length > 0) {
    let bestIdx = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      const cand = pool[i];
      let maxSim = 0;
      for (const s of selected) {
        const sim = cosine(cand.vector, s.vector);
        if (sim > maxSim) maxSim = sim;
      }
      const mmr = lambda * cand.relevance - (1 - lambda) * maxSim;
      if (mmr > bestScore) {
        bestScore = mmr;
        bestIdx = i;
      }
    }
    selected.push(pool.splice(bestIdx, 1)[0]);
  }

  return selected.map((c) => c.item);
}
