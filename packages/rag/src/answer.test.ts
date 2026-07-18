import { describe, expect, it } from "vitest";
import type { Block, RetrievedContext } from "@atlas/contracts";
import { buildPrompt } from "./answer.js";

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
});
