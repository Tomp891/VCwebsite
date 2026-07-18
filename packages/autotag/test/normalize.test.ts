import { describe, it, expect } from "vitest";
import { mockBlocks } from "@atlas/contracts";
import {
  normalizeTag,
  buildTaxonomy,
  dedupeAgainstTaxonomy,
} from "../src/index.js";

describe("normalizeTag", () => {
  it("lowercases, trims and collapses punctuation/whitespace to hyphens", () => {
    expect(normalizeTag("  Local First  ")).toBe("local-first");
    expect(normalizeTag("Graph!!!Theory")).toBe("graph-theory");
  });

  it("strips leading/trailing separators", () => {
    expect(normalizeTag("--graph--")).toBe("graph");
    expect(normalizeTag("!!!graph!!!")).toBe("graph");
  });

  it("naively singularizes a trailing plural", () => {
    expect(normalizeTag("graphs")).toBe("graph");
    expect(normalizeTag("categories")).toBe("category");
    expect(normalizeTag("classes")).toBe("class");
  });

  it("does not singularize short tags or 'ss' endings", () => {
    expect(normalizeTag("ai")).toBe("ai");
    expect(normalizeTag("rag")).toBe("rag");
    expect(normalizeTag("class")).toBe("class");
  });

  it("returns an empty string when nothing survives", () => {
    expect(normalizeTag("!!!")).toBe("");
    expect(normalizeTag("   ")).toBe("");
  });

  it("is deterministic", () => {
    expect(normalizeTag("Knowledge Graphs")).toBe(
      normalizeTag("Knowledge Graphs"),
    );
  });
});

describe("buildTaxonomy", () => {
  it("returns the unique, normalized, sorted set of tags from the corpus", () => {
    expect(buildTaxonomy(mockBlocks)).toEqual([
      "3d",
      "ai",
      "architecture",
      "design",
      "embedding",
      "graph",
      "local-first",
      "pkm",
      "rag",
      "sync",
    ]);
  });

  it("returns [] for an empty corpus", () => {
    expect(buildTaxonomy([])).toEqual([]);
  });

  it("normalizes and dedupes variant spellings", () => {
    const taxonomy = buildTaxonomy([
      { ...mockBlocks[0], props: { tags: ["Graphs", "graph", "PKM"] } },
    ]);
    expect(taxonomy).toEqual(["graph", "pkm"]);
  });
});

describe("dedupeAgainstTaxonomy", () => {
  const taxonomy = buildTaxonomy(mockBlocks);

  it("reuses an exact normalized match without marking it new", () => {
    expect(dedupeAgainstTaxonomy("Graphs", taxonomy)).toEqual({
      tag: "graph",
      canonical: "graph",
      isNew: false,
    });
  });

  it("maps a near match onto the existing taxonomy entry", () => {
    const res = dedupeAgainstTaxonomy("graph theory", taxonomy);
    expect(res.canonical).toBe("graph");
    expect(res.tag).toBe("graph");
    expect(res.isNew).toBe(false);
  });

  it("marks a genuinely new candidate as new with no canonical", () => {
    expect(dedupeAgainstTaxonomy("python", taxonomy)).toEqual({
      tag: "python",
      canonical: null,
      isNew: true,
    });
  });

  it("handles an empty candidate gracefully", () => {
    expect(dedupeAgainstTaxonomy("!!!", taxonomy)).toEqual({
      tag: "",
      canonical: null,
      isNew: false,
    });
  });
});
