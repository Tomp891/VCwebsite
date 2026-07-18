/**
 * Pluggable AI providers implementing the `AIProvider` contract.
 *
 * - `createMockProvider` is dependency-free and deterministic; it is the default
 *   used by the Demo so nothing external needs to run.
 * - `createOllamaProvider` talks to a local Ollama HTTP API.
 */

import type { AIProvider } from "@atlas/contracts";
import { contentTokens } from "./text.js";

/**
 * Embedding layout: a fixed "common" subspace concatenated with a lexical "bag"
 * subspace. The common block is identical for every text, giving all documents a
 * shared baseline direction (real embedding models are similarly anisotropic);
 * the bag block is a hashed bag of tokens + character n-grams that captures
 * lexical overlap. This keeps cosine similarity meaningful (related texts score
 * higher) while landing related pairs around the ~0.7 threshold rather than ~0.
 */
const COMMON_DIM = 64;
const BAG_DIM = 512;
const EMBED_DIM = COMMON_DIM + BAG_DIM;
/** weight of the shared baseline component; wCommon^2 + wBag^2 = 1. */
const W_COMMON = Math.sqrt(0.6);
const W_BAG = Math.sqrt(0.4);

/**
 * Deterministic pseudo-embedding derived from token hashing. Similar texts share
 * tokens (and subword n-grams), which land in the same dimensions, so cosine
 * similarity is meaningful for similar text.
 */
function hashEmbed(text: string): number[] {
  const vec = new Array<number>(EMBED_DIM).fill(0);

  const bag = new Array<number>(BAG_DIM).fill(0);
  for (const token of contentTokens(text)) {
    addFeature(bag, `w_${token}`, 2);
    const padded = `^${token}$`;
    for (let n = 3; n <= 4; n++) {
      for (let i = 0; i + n <= padded.length; i++) {
        addFeature(bag, padded.slice(i, i + n), 1);
      }
    }
  }
  const bagUnit = normalize(bag);

  // Shared baseline direction: constant, so it is identical for every document.
  const commonUnit = W_COMMON / Math.sqrt(COMMON_DIM);
  for (let i = 0; i < COMMON_DIM; i++) vec[i] = commonUnit;
  for (let i = 0; i < BAG_DIM; i++) vec[COMMON_DIM + i] = W_BAG * bagUnit[i];

  return vec;
}

function addFeature(vec: number[], feature: string, weight: number): void {
  vec[hashString(feature) % vec.length] += weight;
}

function normalize(vec: number[]): number[] {
  let mag = 0;
  for (const v of vec) mag += v * v;
  mag = Math.sqrt(mag);
  if (mag === 0) return vec;
  return vec.map((v) => v / mag);
}

/** FNV-1a 32-bit hash. */
function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function createMockProvider(): AIProvider {
  return {
    async embed(texts: string[]): Promise<number[][]> {
      return texts.map(hashEmbed);
    },
    async chat(prompt: string): Promise<string> {
      const trimmed = prompt.trim();
      const preview = trimmed.length > 600 ? `${trimmed.slice(0, 600)}…` : trimmed;
      return [
        "[mock provider] No live model is running, so here is the context I was given:",
        "",
        preview,
      ].join("\n");
    },
  };
}

export interface OllamaOptions {
  baseUrl?: string;
  embedModel?: string;
  chatModel?: string;
  /**
   * Task prefix prepended to every embed input. Models like `nomic-embed-text`
   * are trained to require one (`search_document:` / `search_query:`); omitting
   * it measurably degrades retrieval. Applied uniformly so query and document
   * vectors stay in the same, comparable space. Set "" to disable.
   */
  embedPrefix?: string;
  /** max concurrent embed requests (the /api/embeddings endpoint is 1/text). */
  embedConcurrency?: number;
}

interface OllamaEmbeddingResponse {
  embedding: number[];
}

interface OllamaGenerateResponse {
  response: string;
}

export interface OllamaProbe {
  /** the base URL that was probed. */
  baseUrl: string;
  /** whether the Ollama HTTP API answered. */
  ok: boolean;
  /** model names Ollama reports as installed (empty if unreachable). */
  models: string[];
  /** failure reason when `ok` is false. */
  error?: string;
}

interface OllamaTagsResponse {
  models?: { name: string }[];
}

/**
 * Check whether a local Ollama server is reachable and list its installed
 * models. Used to decide whether to run locally or fall back to the mock, and to
 * surface status in the UI. Never throws — a down server resolves to `ok:false`.
 */
export async function probeOllama(
  baseUrl = "http://localhost:11434",
  timeoutMs = 1500,
): Promise<OllamaProbe> {
  const url = baseUrl.replace(/\/$/, "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${url}/api/tags`, { signal: controller.signal });
    if (!res.ok) {
      return { baseUrl: url, ok: false, models: [], error: `HTTP ${res.status}` };
    }
    const data = (await res.json()) as OllamaTagsResponse;
    const models = (data.models ?? []).map((m) => m.name);
    return { baseUrl: url, ok: true, models };
  } catch (err) {
    const error =
      err instanceof Error
        ? err.name === "AbortError"
          ? "timed out"
          : err.message
        : String(err);
    return { baseUrl: url, ok: false, models: [], error };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A provider that delegates to `primary` and, if a call throws (e.g. Ollama is
 * not running), transparently falls back to `fallback`. `onFallback` is invoked
 * once per failing call so the host can surface that the mock answered. This
 * keeps the app usable offline while preferring the real local model.
 */
export function createFallbackProvider(
  primary: AIProvider,
  fallback: AIProvider,
  onFallback?: (op: "embed" | "chat", error: unknown) => void,
): AIProvider {
  return {
    async embed(texts: string[]): Promise<number[][]> {
      try {
        return await primary.embed(texts);
      } catch (err) {
        onFallback?.("embed", err);
        return fallback.embed(texts);
      }
    },
    async chat(prompt: string): Promise<string> {
      try {
        return await primary.chat(prompt);
      } catch (err) {
        onFallback?.("chat", err);
        return fallback.chat(prompt);
      }
    },
  };
}

export function createOllamaProvider(opts: OllamaOptions = {}): AIProvider {
  const baseUrl = (opts.baseUrl ?? "http://localhost:11434").replace(/\/$/, "");
  const embedModel = opts.embedModel ?? "nomic-embed-text";
  const chatModel = opts.chatModel ?? "llama3.2";
  const embedPrefix = opts.embedPrefix ?? "search_document: ";
  const concurrency = Math.max(1, opts.embedConcurrency ?? 8);

  return {
    async embed(texts: string[]): Promise<number[][]> {
      const embedOne = async (text: string): Promise<number[]> => {
        const res = await fetch(`${baseUrl}/api/embeddings`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: embedModel, prompt: `${embedPrefix}${text}` }),
        });
        if (!res.ok) {
          throw new Error(`Ollama embeddings failed: ${res.status} ${res.statusText}`);
        }
        const data = (await res.json()) as OllamaEmbeddingResponse;
        return data.embedding;
      };

      // Bounded-concurrency pool: /api/embeddings takes one prompt per call, so
      // fan out several in flight instead of one strictly-sequential round-trip
      // per text (the previous behaviour, O(N) latency per question).
      const out = new Array<number[]>(texts.length);
      let next = 0;
      async function worker(): Promise<void> {
        while (next < texts.length) {
          const i = next++;
          out[i] = await embedOne(texts[i]);
        }
      }
      await Promise.all(
        Array.from({ length: Math.min(concurrency, texts.length) }, () => worker()),
      );
      return out;
    },
    async chat(prompt: string): Promise<string> {
      const res = await fetch(`${baseUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: chatModel, prompt, stream: false }),
      });
      if (!res.ok) {
        throw new Error(`Ollama chat failed: ${res.status} ${res.statusText}`);
      }
      const data = (await res.json()) as OllamaGenerateResponse;
      return data.response;
    },
  };
}
