/**
 * Retrieval evaluation harness.
 *
 * Turns "is retrieval good?" from a gut feeling into numbers. Given a labelled
 * dataset (question -> the block ids that should be retrieved), it runs any
 * `Retriever` and reports precision@k, recall@k, hit@k and MRR — so tuning knobs
 * like rankWeight / lexicalWeight / mmrLambda become measurable instead of
 * guessed. Fully local and deterministic when used with the mock provider.
 */
import type { BlockId, Retriever } from "@atlas/contracts";

/** One labelled question and the block ids considered relevant to it. */
export interface EvalCase {
  /** stable id for reporting; defaults to the query text. */
  id?: string;
  query: string;
  relevant: BlockId[];
}

export type EvalDataset = EvalCase[];

/** Metrics for a single query at cutoff k. */
export interface CaseMetrics {
  id: string;
  query: string;
  precision: number;
  recall: number;
  hit: number;
  reciprocalRank: number;
  /** ids the retriever returned, in rank order (for debugging misses). */
  retrieved: BlockId[];
}

/** Dataset-level means plus the per-case breakdown. */
export interface EvalResult {
  k: number;
  cases: number;
  precisionAtK: number;
  recallAtK: number;
  hitAtK: number;
  mrr: number;
  perCase: CaseMetrics[];
}

function topK(ids: BlockId[], k: number): BlockId[] {
  return ids.slice(0, Math.max(0, k));
}

function intersectionCount(ids: BlockId[], relevant: Set<BlockId>): number {
  let n = 0;
  for (const id of ids) if (relevant.has(id)) n += 1;
  return n;
}

/** Fraction of the top-k results that are relevant. */
export function precisionAtK(retrieved: BlockId[], relevant: Set<BlockId>, k: number): number {
  if (k <= 0) return 0;
  return intersectionCount(topK(retrieved, k), relevant) / k;
}

/** Fraction of the relevant items found within the top-k. */
export function recallAtK(retrieved: BlockId[], relevant: Set<BlockId>, k: number): number {
  if (relevant.size === 0) return 0;
  return intersectionCount(topK(retrieved, k), relevant) / relevant.size;
}

/** 1 if any relevant item appears in the top-k, else 0. */
export function hitAtK(retrieved: BlockId[], relevant: Set<BlockId>, k: number): number {
  return intersectionCount(topK(retrieved, k), relevant) > 0 ? 1 : 0;
}

/** 1 / rank of the first relevant item across the full list (0 if none). */
export function reciprocalRank(retrieved: BlockId[], relevant: Set<BlockId>): number {
  for (let i = 0; i < retrieved.length; i++) {
    if (relevant.has(retrieved[i])) return 1 / (i + 1);
  }
  return 0;
}

function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

/**
 * Run `retriever` over every case and aggregate metrics at cutoff `k`.
 * Cases run sequentially so a shared, mutating index/provider stays consistent.
 */
export async function runEval(
  retriever: Retriever,
  dataset: EvalDataset,
  k = 5,
): Promise<EvalResult> {
  const perCase: CaseMetrics[] = [];
  for (const c of dataset) {
    const ctx = await retriever.retrieve(c.query);
    const retrieved = ctx.blocks.map((b) => b.id);
    const relevant = new Set(c.relevant);
    perCase.push({
      id: c.id ?? c.query,
      query: c.query,
      precision: precisionAtK(retrieved, relevant, k),
      recall: recallAtK(retrieved, relevant, k),
      hit: hitAtK(retrieved, relevant, k),
      reciprocalRank: reciprocalRank(retrieved, relevant),
      retrieved,
    });
  }
  return {
    k,
    cases: perCase.length,
    precisionAtK: mean(perCase.map((c) => c.precision)),
    recallAtK: mean(perCase.map((c) => c.recall)),
    hitAtK: mean(perCase.map((c) => c.hit)),
    mrr: mean(perCase.map((c) => c.reciprocalRank)),
    perCase,
  };
}

/** Human-readable summary for a console/CI log. */
export function formatReport(result: EvalResult): string {
  const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;
  const num = (x: number): string => x.toFixed(3);
  const lines = [
    `Retrieval eval — ${result.cases} cases @k=${result.k}`,
    `  precision@${result.k}: ${pct(result.precisionAtK)}`,
    `  recall@${result.k}:    ${pct(result.recallAtK)}`,
    `  hit@${result.k}:       ${pct(result.hitAtK)}`,
    `  MRR:            ${num(result.mrr)}`,
    "  misses:",
  ];
  const misses = result.perCase.filter((c) => c.hit === 0);
  if (misses.length === 0) lines.push("    (none)");
  else for (const m of misses) lines.push(`    ✗ ${m.id}`);
  return lines.join("\n");
}
