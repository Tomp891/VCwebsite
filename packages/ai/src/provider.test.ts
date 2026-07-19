import { afterEach, describe, expect, it, vi } from "vitest";
import type { AIProvider } from "@atlas/contracts";
import {
  createFallbackProvider,
  createMockProvider,
  createOllamaProvider,
  probeOllama,
} from "./provider.js";

const failing: AIProvider = {
  embed() {
    return Promise.reject(new Error("connection refused"));
  },
  chat() {
    return Promise.reject(new Error("connection refused"));
  },
};

const ok: AIProvider = {
  embed(texts) {
    return Promise.resolve(texts.map(() => [1, 2, 3]));
  },
  chat() {
    return Promise.resolve("live answer");
  },
};

describe("createFallbackProvider", () => {
  it("uses the primary when it succeeds", async () => {
    const onFallback = vi.fn();
    const p = createFallbackProvider(ok, createMockProvider(), onFallback);
    expect(await p.chat("hi")).toBe("live answer");
    expect(await p.embed(["a"])).toEqual([[1, 2, 3]]);
    expect(onFallback).not.toHaveBeenCalled();
  });

  it("falls back to the secondary when the primary throws", async () => {
    const onFallback = vi.fn();
    const mock = createMockProvider();
    const p = createFallbackProvider(failing, mock, onFallback);

    const answer = await p.chat("question");
    expect(answer).toContain("[mock provider]");

    const vecs = await p.embed(["a", "b"]);
    expect(vecs).toHaveLength(2);

    expect(onFallback).toHaveBeenCalledTimes(2);
    expect(onFallback).toHaveBeenCalledWith("chat", expect.any(Error));
    expect(onFallback).toHaveBeenCalledWith("embed", expect.any(Error));
  });
});

describe("chatStream", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("mock provider streams the deterministic answer token-by-token", async () => {
    const mock = createMockProvider();
    const chunks: string[] = [];
    const full = await mock.chatStream!("my prompt", (c) => chunks.push(c));
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join("")).toBe(full);
    expect(full).toBe(await mock.chat("my prompt"));
  });

  it("ollama provider parses newline-delimited JSON chunks", async () => {
    const ndjson =
      JSON.stringify({ response: "Hello" }) +
      "\n" +
      JSON.stringify({ response: " world" }) +
      "\n" +
      JSON.stringify({ response: "!", done: true }) +
      "\n";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(ndjson, { status: 200 })),
    );
    const provider = createOllamaProvider({ chatModel: "llama3.1:8b" });
    const chunks: string[] = [];
    const full = await provider.chatStream!("q", (c) => chunks.push(c));
    expect(chunks).toEqual(["Hello", " world", "!"]);
    expect(full).toBe("Hello world!");
  });

  it("fallback streams via the mock when the primary throws", async () => {
    const onFallback = vi.fn();
    const p = createFallbackProvider(failing, createMockProvider(), onFallback);
    const chunks: string[] = [];
    const full = await p.chatStream!("q", (c) => chunks.push(c));
    expect(chunks.join("")).toBe(full);
    expect(full).toContain("[mock provider]");
    expect(onFallback).toHaveBeenCalledWith("chat", expect.any(Error));
  });
});

describe("createOllamaProvider embed", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("adds the task prefix, batches, and preserves input order", async () => {
    const prompts: string[] = [];
    // Respond with a vector whose first component encodes the input index so we
    // can assert output order matches input order despite concurrent requests.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string) as { prompt: string };
        prompts.push(body.prompt);
        const n = Number(body.prompt.replace(/\D/g, ""));
        // Stagger completion so earlier requests resolve later.
        await new Promise((r) => setTimeout(r, (5 - n) * 2));
        return new Response(JSON.stringify({ embedding: [n] }), { status: 200 });
      }),
    );

    const provider = createOllamaProvider({ embedModel: "nomic-embed-text" });
    const vecs = await provider.embed(["t1", "t2", "t3", "t4"]);

    expect(vecs).toEqual([[1], [2], [3], [4]]);
    expect(prompts).toContain("search_document: t1");
    expect(prompts.every((p) => p.startsWith("search_document: "))).toBe(true);
  });

  it("honours a custom (or empty) prefix", async () => {
    const prompts: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        prompts.push((JSON.parse(init.body as string) as { prompt: string }).prompt);
        return new Response(JSON.stringify({ embedding: [0] }), { status: 200 });
      }),
    );
    const provider = createOllamaProvider({ embedPrefix: "" });
    await provider.embed(["raw"]);
    expect(prompts).toEqual(["raw"]);
  });
});

describe("probeOllama", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports installed models when the server answers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ models: [{ name: "llama3.1:8b" }, { name: "nomic-embed-text" }] }),
          { status: 200 },
        ),
      ),
    );
    const probe = await probeOllama("http://localhost:11434/");
    expect(probe.ok).toBe(true);
    expect(probe.models).toEqual(["llama3.1:8b", "nomic-embed-text"]);
    expect(probe.baseUrl).toBe("http://localhost:11434");
  });

  it("returns ok:false without throwing when unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );
    const probe = await probeOllama("http://localhost:11434");
    expect(probe.ok).toBe(false);
    expect(probe.models).toEqual([]);
    expect(probe.error).toContain("ECONNREFUSED");
  });
});
