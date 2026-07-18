import { afterEach, describe, expect, it, vi } from "vitest";
import type { AIProvider } from "@atlas/contracts";
import {
  createFallbackProvider,
  createMockProvider,
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
