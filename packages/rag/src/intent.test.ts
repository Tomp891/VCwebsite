import { describe, expect, it } from "vitest";
import {
  augmentForRetrieval,
  classifyScope,
  isFollowup,
} from "./intent.js";

describe("classifyScope (lexical fallback, no embed)", () => {
  it("flags explicit broad keywords as broad (EN/NL)", async () => {
    expect(await classifyScope("give me an overview of everything")).toBe("broad");
    expect(await classifyScope("vergelijk de thema's in mijn notes")).toBe("broad");
  });

  it("treats a pointed question as specific", async () => {
    expect(await classifyScope("what does the CRDT note say about merges")).toBe("specific");
  });
});

describe("classifyScope (embedding-based)", () => {
  // Deterministic fake embedder: broad-ish words push dimension 0, specific
  // words push dimension 1, so paraphrases without keywords still classify.
  const embed = (texts: string[]): Promise<number[][]> =>
    Promise.resolve(
      texts.map((t) => {
        const lower = t.toLowerCase();
        const broad = /overview|everything|themes|big picture|summar|all|main/.test(lower) ? 1 : 0;
        const specific = /specific|single|precise|particular|one /.test(lower) ? 1 : 0;
        return [broad, specific];
      }),
    );

  it("classifies a paraphrase with no hard-coded keyword as broad", async () => {
    // "the big picture" hits the broad anchors via the fake embedding space.
    expect(await classifyScope("show me the big picture", { embed })).toBe("broad");
  });
});

describe("isFollowup / augmentForRetrieval", () => {
  it("detects short or pronoun-referential queries", () => {
    expect(isFollowup("what about that?")).toBe(true);
    expect(isFollowup("and the second one")).toBe(true);
    expect(isFollowup("explain the internals of the CRDT merge algorithm in detail")).toBe(false);
  });

  it("prepends the prior question only for follow-ups", () => {
    expect(augmentForRetrieval("what about it?", ["Tell me about GraphRAG"])).toBe(
      "Tell me about GraphRAG what about it?",
    );
    expect(
      augmentForRetrieval("explain the full CRDT merge algorithm design", ["earlier question"]),
    ).toBe("explain the full CRDT merge algorithm design");
    expect(augmentForRetrieval("what about it?", [])).toBe("what about it?");
  });
});
