import { describe, expect, it } from "vitest";
import type { AIProvider, Block, RetrievedContext } from "@atlas/contracts";
import { answer, buildPrompt } from "./answer.js";

function block(id: string, content: string): Block {
  const now = Date.now();
  return {
    id,
    parentId: null,
    order: 0,
    type: "text",
    content,
    props: {},
    createdAt: now,
    updatedAt: now,
  };
}

const ctx: RetrievedContext = {
  blocks: [block("n1", "GraphRAG combines vector search with graph traversal.")],
  path: ["n1"],
};

describe("buildPrompt", () => {
  it("includes retrieved sources and the question", () => {
    const prompt = buildPrompt("What is GraphRAG?", ctx);
    expect(prompt).toContain("[n1] GraphRAG combines");
    expect(prompt).toContain("Question: What is GraphRAG?");
    expect(prompt).not.toContain("Knowledge base overview:");
  });

  it("injects the knowledge-base overview when provided", () => {
    const overview = "Total notes/blocks: 8 (top-level pages: 8).\nTags (3): #ai, #graph, #pkm.";
    const prompt = buildPrompt("How many notes do I have?", ctx, overview);
    expect(prompt).toContain("Knowledge base overview:");
    expect(prompt).toContain("Total notes/blocks: 8");
    expect(prompt).toContain("Tags (3): #ai, #graph, #pkm.");
  });

  it("omits the overview section for empty overview text", () => {
    const prompt = buildPrompt("hi", ctx, "   ");
    expect(prompt).not.toContain("Knowledge base overview:");
  });

  it("injects theme summaries and prior conversation when provided", () => {
    const prompt = buildPrompt("follow up", ctx, undefined, {
      themes: ["Local-first Sync: how notes stay offline"],
      history: [{ question: "What is GraphRAG?", answer: "It blends vectors + graph." }],
    });
    expect(prompt).toContain("Themes in the knowledge base:");
    expect(prompt).toContain("- Local-first Sync: how notes stay offline");
    expect(prompt).toContain("Previous conversation (for context):");
    expect(prompt).toContain("Q: What is GraphRAG?");
  });

  it("clips overly long sources to the per-source budget", () => {
    const long = block("big", "x".repeat(50));
    const prompt = buildPrompt("q", { blocks: [long], path: ["big"] }, undefined, {
      maxCharsPerSource: 10,
    });
    expect(prompt).toContain("[big] xxxxxxxxx…");
    expect(prompt).not.toContain("x".repeat(50));
  });
});

const provider = (text: string): AIProvider => ({
  embed: (t) => Promise.resolve(t.map(() => [0])),
  chat: () => Promise.resolve(text),
});

const multi: RetrievedContext = {
  blocks: [block("n1", "a"), block("n2", "b"), block("n3", "c"), block("n4", "d")],
  path: ["n1", "n2", "n3", "n4"],
};

describe("answer citation fallback", () => {
  it("uses the model's explicit citations when present", async () => {
    const ans = await answer("q", multi, provider("per [n3]."));
    expect(ans.citations).toEqual(["n3"]);
  });

  it("falls back to the top few retrieved blocks, not all of them", async () => {
    const ans = await answer("q", multi, provider("no citations here"));
    // importance-ordered path head, capped (default 3) — not every known id.
    expect(ans.citations).toEqual(["n1", "n2", "n3"]);
  });
});
