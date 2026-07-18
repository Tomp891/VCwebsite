/**
 * Standalone demo: a deterministic in-memory provider + store built from the
 * contract mock fixtures, wired into <ChatPanel/> so the GraphRAG flow can be
 * eyeballed with no backend. Real wiring to Ollama happens at integration.
 */
import { useMemo } from "react";
import type {
  AIProvider,
  Block,
  BlockId,
  Edge,
  EdgeId,
  EditorStore,
} from "@atlas/contracts";
import { mockBlocks, mockEdges } from "@atlas/contracts";
import { ChatPanel } from "./ChatPanel.js";
import { createRetriever } from "./retriever.js";

const EMBED_DIM = 64;

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

/** Stable string hash (FNV-1a) so embeddings are deterministic across runs. */
function hash(token: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Bag-of-words hashed into a fixed vector — cheap deterministic pseudo-embeddings. */
function embedText(text: string): number[] {
  const vec = new Array<number>(EMBED_DIM).fill(0);
  for (const tok of tokenize(text)) vec[hash(tok) % EMBED_DIM] += 1;
  return vec;
}

/** Mock provider: pseudo-embeddings + a chat() that summarises the sources. */
export const mockProvider: AIProvider = {
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map(embedText);
  },
  async chat(prompt: string): Promise<string> {
    const question = prompt.match(/Question:\s*(.*)/)?.[1]?.trim() ?? "your query";
    const sources = [...prompt.matchAll(/\[([^\]]+)\]\s*(.+)/g)].map((m) => ({
      id: m[1],
      content: m[2],
    }));
    if (sources.length === 0) {
      return `I could not find anything in the atlas relevant to "${question}".`;
    }
    const lead = sources[0];
    const cites = sources.slice(0, 3).map((s) => `[${s.id}]`).join(" ");
    return (
      `Regarding "${question}": ${lead.content} ${cites} ` +
      `Related notes were traversed to ground this answer.`
    );
  },
};

/** Minimal in-memory EditorStore over the mock fixtures. */
export function createMockStore(
  blocks: Block[] = mockBlocks,
  edges: Edge[] = mockEdges,
): EditorStore {
  const blockMap = new Map<BlockId, Block>(blocks.map((b) => [b.id, b]));
  const edgeMap = new Map<EdgeId, Edge>(edges.map((e) => [e.id, e]));
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((fn) => fn());
  let seq = 0;
  const nextId = (prefix: string) => `${prefix}-${Date.now()}-${seq++}`;

  return {
    listBlocks: () => [...blockMap.values()],
    getBlock: (id) => blockMap.get(id),
    upsertBlock: (patch) => {
      const now = Date.now();
      const existing = blockMap.get(patch.id);
      const merged: Block = existing
        ? { ...existing, ...patch, updatedAt: now }
        : {
            id: patch.id,
            parentId: patch.parentId ?? null,
            order: patch.order ?? 0,
            type: patch.type ?? "text",
            content: patch.content ?? "",
            props: patch.props ?? {},
            createdAt: now,
            updatedAt: now,
          };
      blockMap.set(merged.id, merged);
      notify();
      return merged;
    },
    createBlock: (input) => {
      const now = Date.now();
      const block: Block = { ...input, id: nextId("b"), createdAt: now, updatedAt: now };
      blockMap.set(block.id, block);
      notify();
      return block;
    },
    deleteBlock: (id) => {
      if (blockMap.delete(id)) notify();
    },
    listEdges: () => [...edgeMap.values()],
    upsertEdge: (edge) => {
      const id = edge.id ?? nextId("e");
      const existing = edgeMap.get(id);
      const merged: Edge = {
        ...edge,
        id,
        createdAt: existing?.createdAt ?? Date.now(),
      };
      edgeMap.set(id, merged);
      notify();
      return merged;
    },
    deleteEdge: (id) => {
      if (edgeMap.delete(id)) notify();
    },
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

export function Demo(): JSX.Element {
  const store = useMemo(() => createMockStore(), []);
  const retriever = useMemo(() => createRetriever(store, mockProvider), [store]);
  return (
    <div style={{ maxWidth: 420, padding: 16 }}>
      <ChatPanel retriever={retriever} provider={mockProvider} />
    </div>
  );
}
