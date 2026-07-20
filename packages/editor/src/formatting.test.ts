import { describe, expect, it } from "vitest";
import { toggleWrap } from "./Editor.js";

describe("toggleWrap", () => {
  it("wraps the selection in the marker", () => {
    const r = toggleWrap("hello world", 6, 11, "**");
    expect(r.value).toBe("hello **world**");
    expect(r.selStart).toBe(8);
    expect(r.selEnd).toBe(13);
  });

  it("unwraps when the selection is already wrapped (markers outside)", () => {
    const r = toggleWrap("hello **world**", 8, 13, "**");
    expect(r.value).toBe("hello world");
    expect(r.selStart).toBe(6);
    expect(r.selEnd).toBe(11);
  });

  it("unwraps when the markers are inside the selection", () => {
    const r = toggleWrap("hello **world**", 6, 15, "**");
    expect(r.value).toBe("hello world");
  });

  it("wraps the word at the caret when there is no selection", () => {
    const r = toggleWrap("hello world", 8, 8, "*");
    expect(r.value).toBe("hello *world*");
  });

  it("supports multi-char and single-char markers", () => {
    expect(toggleWrap("ab", 0, 2, "==").value).toBe("==ab==");
    expect(toggleWrap("ab", 0, 2, "`").value).toBe("`ab`");
    expect(toggleWrap("ab", 0, 2, "~~").value).toBe("~~ab~~");
  });
});
