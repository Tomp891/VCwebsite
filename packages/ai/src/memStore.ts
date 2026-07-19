/**
 * Minimal in-memory `EditorStore` used by the Demo (and handy for tests). Not a
 * persistence layer — Agent A owns the real store; this just satisfies the
 * contract over plain arrays so the panel can be eyeballed in isolation.
 */

import type { Block, BlockId, Edge, EdgeId, EditorStore } from "@atlas/contracts";

export function createMemoryStore(
  initialBlocks: Block[] = [],
  initialEdges: Edge[] = [],
): EditorStore {
  const blocks = new Map<BlockId, Block>(initialBlocks.map((b) => [b.id, b]));
  const edges = new Map<EdgeId, Edge>(initialEdges.map((e) => [e.id, e]));
  const listeners = new Set<() => void>();
  let seq = 0;

  const emit = () => listeners.forEach((fn) => fn());
  const nextId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${seq++}`;

  return {
    listBlocks() {
      return [...blocks.values()];
    },
    getBlock(id) {
      return blocks.get(id);
    },
    upsertBlock(patch) {
      const now = Date.now();
      const existing = blocks.get(patch.id);
      const next: Block = existing
        ? { ...existing, ...patch, updatedAt: now }
        : {
            parentId: null,
            order: blocks.size,
            type: "text",
            content: "",
            props: {},
            createdAt: now,
            updatedAt: now,
            ...patch,
          };
      blocks.set(next.id, next);
      emit();
      return next;
    },
    createBlock(input) {
      const now = Date.now();
      const block: Block = { ...input, id: nextId("b"), createdAt: now, updatedAt: now };
      blocks.set(block.id, block);
      emit();
      return block;
    },
    deleteBlock(id) {
      if (blocks.delete(id)) emit();
    },
    listEdges() {
      return [...edges.values()];
    },
    upsertEdge(edge) {
      const id = edge.id ?? nextId("e");
      const existing = edges.get(id);
      const next: Edge = {
        ...edge,
        id,
        createdAt: existing?.createdAt ?? Date.now(),
      };
      edges.set(id, next);
      emit();
      return next;
    },
    deleteEdge(id) {
      if (edges.delete(id)) emit();
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}
