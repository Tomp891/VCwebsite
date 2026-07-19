import { describe, expect, it } from "vitest";
import { markdownShortcut } from "./Editor.js";

describe("markdownShortcut", () => {
  it("converts leading tokens to block kinds and strips the prefix", () => {
    expect(markdownShortcut("text", "# Title")).toEqual({ type: "heading", content: "Title" });
    expect(markdownShortcut("text", "### Deep")).toEqual({ type: "heading", content: "Deep" });
    expect(markdownShortcut("text", "> quoted")).toEqual({ type: "quote", content: "quoted" });
    expect(markdownShortcut("text", "[] task")).toEqual({ type: "todo", content: "task" });
    expect(markdownShortcut("text", "[ ] task")).toEqual({ type: "todo", content: "task" });
    expect(markdownShortcut("text", "- item")).toEqual({ type: "bullet", content: "item" });
  });

  it("returns null when nothing matches or the prefix is incomplete", () => {
    expect(markdownShortcut("text", "no prefix")).toBeNull();
    expect(markdownShortcut("text", "#nospace")).toBeNull();
    expect(markdownShortcut("text", "")).toBeNull();
  });

  it("does not re-fire on an already styled block", () => {
    expect(markdownShortcut("heading", "# again")).toBeNull();
    expect(markdownShortcut("todo", "[] again")).toBeNull();
    expect(markdownShortcut("quote", "> again")).toBeNull();
  });

  it("keeps trailing content after the prefix intact", () => {
    expect(markdownShortcut("text", "# a b c")).toEqual({ type: "heading", content: "a b c" });
  });
});
