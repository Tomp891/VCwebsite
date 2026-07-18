import type { Block, BlockId, Edge, EdgeId, EditorStore } from "@atlas/contracts";
import { mockBlocks, mockEdges } from "@atlas/contracts";
import { parseWikilinks, resolveWikilink } from "./wikilinks.js";

const BLOCKS_KEY = "atlas.editor.blocks";
const EDGES_KEY = "atlas.editor.edges";

type Persisted = { blocks: Block[]; edges: Edge[] };

/** Minimal storage surface; falls back to an in-memory shim outside the browser. */
interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function getBackingStore(): KeyValueStore {
  if (typeof localStorage !== "undefined") return localStorage;
  const mem = new Map<string, string>();
  return {
    getItem: (k) => (mem.has(k) ? (mem.get(k) as string) : null),
    setItem: (k, v) => {
      mem.set(k, v);
    },
  };
}

function newId(prefix: string): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `${prefix}_${rand}`;
}

/** Deep-ish clone so callers cannot mutate internal state by reference. */
function cloneBlock(b: Block): Block {
  return { ...b, props: { ...b.props } };
}
function cloneEdge(e: Edge): Edge {
  return { ...e, provenance: { ...e.provenance } };
}

export function createLocalStore(): EditorStore {
  const backing = getBackingStore();
  const blocks = new Map<BlockId, Block>();
  const edges = new Map<EdgeId, Edge>();
  const listeners = new Set<() => void>();

  function persist(): void {
    const data: Persisted = {
      blocks: [...blocks.values()],
      edges: [...edges.values()],
    };
    backing.setItem(BLOCKS_KEY, JSON.stringify(data.blocks));
    backing.setItem(EDGES_KEY, JSON.stringify(data.edges));
  }

  function emit(): void {
    for (const fn of listeners) fn();
  }

  function commit(): void {
    persist();
    emit();
  }

  function load(): void {
    const rawBlocks = backing.getItem(BLOCKS_KEY);
    const rawEdges = backing.getItem(EDGES_KEY);
    if (rawBlocks !== null) {
      try {
        const parsed = JSON.parse(rawBlocks) as Block[];
        for (const b of parsed) blocks.set(b.id, b);
        if (rawEdges !== null) {
          const parsedEdges = JSON.parse(rawEdges) as Edge[];
          for (const e of parsedEdges) edges.set(e.id, e);
        }
        return;
      } catch {
        blocks.clear();
        edges.clear();
      }
    }
    // First run (or corrupted storage): seed from the frozen mock fixtures.
    for (const b of mockBlocks) blocks.set(b.id, cloneBlock(b));
    for (const e of mockEdges) edges.set(e.id, cloneEdge(e));
    persist();
  }

  /**
   * Rebuild the explicit `[[wikilink]]` edges originating from `srcId` to match
   * its current content. Creates a new page block for any unresolved target.
   * Mutates internal maps only; caller is responsible for commit().
   */
  function syncWikilinkEdges(srcId: BlockId): void {
    const src = blocks.get(srcId);
    if (!src) return;

    // Drop the previously-derived wikilink edges from this source.
    for (const [id, e] of edges) {
      if (e.srcBlockId === srcId && e.provenance.method === "wikilink") edges.delete(id);
    }

    const targets = parseWikilinks(src.content);
    for (const text of targets) {
      let dstId = resolveWikilink(text, [...blocks.values()]);
      if (dstId === undefined) {
        const now = Date.now();
        dstId = newId("blk");
        blocks.set(dstId, {
          id: dstId,
          parentId: null,
          order: blocks.size,
          type: "page",
          content: text,
          props: { title: text },
          createdAt: now,
          updatedAt: now,
        });
      }
      if (dstId === srcId) continue; // never self-link
      const edgeId = newId("edg");
      edges.set(edgeId, {
        id: edgeId,
        srcBlockId: srcId,
        dstBlockId: dstId,
        type: "link",
        tier: "explicit",
        confidence: 1,
        provenance: { method: "wikilink" },
        createdAt: Date.now(),
      });
    }
  }

  load();

  const store: EditorStore = {
    listBlocks(): Block[] {
      return [...blocks.values()].map(cloneBlock);
    },

    getBlock(id: BlockId): Block | undefined {
      const b = blocks.get(id);
      return b ? cloneBlock(b) : undefined;
    },

    upsertBlock(patch: Partial<Block> & { id: BlockId }): Block {
      const existing = blocks.get(patch.id);
      const now = Date.now();
      const next: Block = existing
        ? { ...existing, ...patch, props: { ...existing.props, ...(patch.props ?? {}) }, updatedAt: now }
        : {
            id: patch.id,
            parentId: patch.parentId ?? null,
            order: patch.order ?? blocks.size,
            type: patch.type ?? "text",
            content: patch.content ?? "",
            props: patch.props ?? {},
            createdAt: now,
            updatedAt: now,
          };
      blocks.set(next.id, next);
      syncWikilinkEdges(next.id);
      commit();
      return cloneBlock(next);
    },

    createBlock(input: Omit<Block, "id" | "createdAt" | "updatedAt">): Block {
      const now = Date.now();
      const block: Block = { ...input, id: newId("blk"), props: { ...input.props }, createdAt: now, updatedAt: now };
      blocks.set(block.id, block);
      syncWikilinkEdges(block.id);
      commit();
      return cloneBlock(block);
    },

    deleteBlock(id: BlockId): void {
      if (!blocks.has(id)) return;
      blocks.delete(id);
      for (const [eid, e] of edges) {
        if (e.srcBlockId === id || e.dstBlockId === id) edges.delete(eid);
      }
      commit();
    },

    listEdges(): Edge[] {
      return [...edges.values()].map(cloneEdge);
    },

    upsertEdge(input: Omit<Edge, "id" | "createdAt"> & { id?: EdgeId }): Edge {
      const id = input.id ?? newId("edg");
      const existing = input.id ? edges.get(input.id) : undefined;
      const next: Edge = {
        id,
        srcBlockId: input.srcBlockId,
        dstBlockId: input.dstBlockId,
        type: input.type,
        tier: input.tier,
        confidence: input.confidence,
        provenance: { ...input.provenance },
        createdAt: existing?.createdAt ?? Date.now(),
      };
      edges.set(id, next);
      commit();
      return cloneEdge(next);
    },

    deleteEdge(id: EdgeId): void {
      if (!edges.has(id)) return;
      edges.delete(id);
      commit();
    },

    subscribe(fn: () => void): () => void {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };

  return store;
}
