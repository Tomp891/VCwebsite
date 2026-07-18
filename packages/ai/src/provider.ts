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
}

interface OllamaEmbeddingResponse {
  embedding: number[];
}

interface OllamaGenerateResponse {
  response: string;
}

export function createOllamaProvider(opts: OllamaOptions = {}): AIProvider {
  const baseUrl = (opts.baseUrl ?? "http://localhost:11434").replace(/\/$/, "");
  const embedModel = opts.embedModel ?? "nomic-embed-text";
  const chatModel = opts.chatModel ?? "llama3.2";

  return {
    async embed(texts: string[]): Promise<number[][]> {
      const out: number[][] = [];
      for (const text of texts) {
        const res = await fetch(`${baseUrl}/api/embeddings`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: embedModel, prompt: text }),
        });
        if (!res.ok) {
          throw new Error(`Ollama embeddings failed: ${res.status} ${res.statusText}`);
        }
        const data = (await res.json()) as OllamaEmbeddingResponse;
        out.push(data.embedding);
      }
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
