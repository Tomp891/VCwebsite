import { afterEach, describe, expect, it, vi } from "vitest";
import { createAnthropicProvider, createFrontierProvider, createOpenAIProvider } from "./frontier.js";

function sse(lines: string[]): string {
  return lines.map((l) => `data: ${l}\n\n`).join("");
}

describe("frontier providers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("anthropic non-streaming joins text blocks and sets browser + auth headers", async () => {
    let sentHeaders: Record<string, string> = {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        sentHeaders = init.headers as Record<string, string>;
        return new Response(
          JSON.stringify({ content: [{ type: "text", text: "hi " }, { type: "text", text: "there" }] }),
          { status: 200 },
        );
      }),
    );
    const p = createAnthropicProvider({ apiKey: "sk-ant", model: "claude-3-5-sonnet-latest" });
    expect(await p.chat("q")).toBe("hi there");
    expect(sentHeaders["x-api-key"]).toBe("sk-ant");
    expect(sentHeaders["anthropic-dangerous-direct-browser-access"]).toBe("true");
    await expect(p.embed(["x"])).rejects.toThrow(/local/);
  });

  it("anthropic streams text_delta events", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          sse([
            JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "Hel" } }),
            JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "lo" } }),
            JSON.stringify({ type: "message_stop" }),
          ]),
          { status: 200 },
        ),
      ),
    );
    const p = createAnthropicProvider({ apiKey: "k", model: "m" });
    const chunks: string[] = [];
    const full = await p.chatStream!("q", (c) => chunks.push(c));
    expect(chunks).toEqual(["Hel", "lo"]);
    expect(full).toBe("Hello");
  });

  it("openai streams delta content and ignores [DONE]", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        expect(url).toContain("openai.com");
        expect((init.headers as Record<string, string>).authorization).toBe("Bearer sk-oa");
        return new Response(
          sse([
            JSON.stringify({ choices: [{ delta: { content: "A" } }] }),
            JSON.stringify({ choices: [{ delta: { content: "B" } }] }),
            "[DONE]",
          ]),
          { status: 200 },
        );
      }),
    );
    const p = createOpenAIProvider({ apiKey: "sk-oa", model: "gpt-4o" });
    const chunks: string[] = [];
    const full = await p.chatStream!("q", (c) => chunks.push(c));
    expect(chunks).toEqual(["A", "B"]);
    expect(full).toBe("AB");
  });

  it("throws with status text on a non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("bad key", { status: 401 })),
    );
    const p = createFrontierProvider("openai", { apiKey: "x", model: "gpt-4o" });
    await expect(p.chat("q")).rejects.toThrow(/401/);
  });
});
