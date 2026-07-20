import { describe, expect, it } from "vitest";
import {
  formatReport,
  hitAtK,
  precisionAtK,
  recallAtK,
  reciprocalRank,
  runEval,
  type EvalDataset,
} from "./eval.js";
import { mockEvalDataset } from "./eval.fixture.js";
import { createMockStore, mockProvider } from "./Demo.js";
import { createRetriever } from "./retriever.js";

describe("metrics", () => {
  const relevant = new Set(["a", "c"]);
  const retrieved = ["b", "a", "d", "c"]; // relevant at ranks 2 and 4

  it("precision@k counts relevant within the cutoff", () => {
    expect(precisionAtK(retrieved, relevant, 2)).toBeCloseTo(0.5); // {b,a} -> 1/2
    expect(precisionAtK(retrieved, relevant, 4)).toBeCloseTo(0.5); // 2/4
    expect(precisionAtK(retrieved, relevant, 0)).toBe(0);
  });

  it("recall@k is over the relevant set size", () => {
    expect(recallAtK(retrieved, relevant, 2)).toBeCloseTo(0.5); // found a -> 1/2
    expect(recallAtK(retrieved, relevant, 4)).toBeCloseTo(1); // found a,c -> 2/2
    expect(recallAtK(retrieved, new Set(), 4)).toBe(0);
  });

  it("hit@k flips once any relevant appears", () => {
    expect(hitAtK(retrieved, relevant, 1)).toBe(0); // only b
    expect(hitAtK(retrieved, relevant, 2)).toBe(1); // a
  });

  it("reciprocalRank uses the first relevant rank", () => {
    expect(reciprocalRank(retrieved, relevant)).toBeCloseTo(1 / 2);
    expect(reciprocalRank(["x", "y"], relevant)).toBe(0);
  });
});

describe("runEval", () => {
  it("scores the real retriever on the labelled mock dataset", async () => {
    const store = createMockStore();
    const retriever = createRetriever(store, mockProvider, { topK: 5 });
    const res = await runEval(retriever, mockEvalDataset, 5);

    expect(res.cases).toBe(mockEvalDataset.length);
    // Deterministic near-verbatim dataset: retrieval should be strong.
    expect(res.hitAtK).toBeGreaterThanOrEqual(0.75);
    expect(res.mrr).toBeGreaterThan(0.5);
    expect(res.precisionAtK).toBeGreaterThan(0);
    expect(res.perCase).toHaveLength(mockEvalDataset.length);
  });

  it("reports perfect scores when every query returns its label first", async () => {
    // A retriever that returns exactly the labelled block, in order.
    const dataset: EvalDataset = [
      { id: "q1", query: "one", relevant: ["b1"] },
      { id: "q2", query: "two", relevant: ["b2"] },
    ];
    const byQuery: Record<string, string> = { one: "b1", two: "b2" };
    const retriever = {
      async retrieve(query: string) {
        const id = byQuery[query];
        return { blocks: [{ id } as never], path: [id] };
      },
    };
    const res = await runEval(retriever, dataset, 3);
    expect(res.precisionAtK).toBeCloseTo((1 / 3 + 1 / 3) / 2);
    expect(res.recallAtK).toBe(1);
    expect(res.hitAtK).toBe(1);
    expect(res.mrr).toBe(1);
  });
});

describe("formatReport", () => {
  it("summarizes metrics and lists misses", async () => {
    const store = createMockStore();
    const retriever = createRetriever(store, mockProvider, { topK: 5 });
    const res = await runEval(retriever, mockEvalDataset, 5);
    const report = formatReport(res);
    expect(report).toContain("Retrieval eval");
    expect(report).toContain("precision@5");
    expect(report).toContain("MRR");
  });
});
