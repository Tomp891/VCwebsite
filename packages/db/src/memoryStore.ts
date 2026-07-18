import type { Block, BlockId, Edge, EdgeId, EditorStore } from "@atlas/contracts";

/**
 * Minimal in-memory EditorStore used by the Demo (and handy for tests). It is a
 * faithful stub of the Agent A contract — enough to render this package in
 * isolation. Integration swaps this for the real store; nothing here is imported
 * across packages.
 */
export function createMemoryStore(seedBlocks: Block[] = [], seedEdges: Edge[] = []): EditorStore {
  const blocks = new Map<BlockId, Block>(seedBlocks.map((b) => [b.id, b]));
  const edges = new Map<EdgeId, Edge>(seedEdges.map((e) => [e.id, e]));
  const subscribers = new Set<() => void>();
  let counter = 0;

  const emit = () => subscribers.forEach((fn) => fn());
  const nextId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${counter++}`;

  return {
    listBlocks: () => [...blocks.values()],
    getBlock: (id) => blocks.get(id),
    upsertBlock: (patch) => {
      const now = Date.now();
      const existing = blocks.get(patch.id);
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
      blocks.set(merged.id, merged);
      emit();
      return merged;
    },
    createBlock: (input) => {
      const now = Date.now();
      const block: Block = { ...input, id: nextId("b"), createdAt: now, updatedAt: now };
      blocks.set(block.id, block);
      emit();
      return block;
    },
    deleteBlock: (id) => {
      if (blocks.delete(id)) emit();
    },
    listEdges: () => [...edges.values()],
    upsertEdge: (edge) => {
      const id = edge.id ?? nextId("e");
      const existing = edges.get(id);
      const merged: Edge = existing
        ? { ...existing, ...edge, id }
        : { ...edge, id, createdAt: Date.now() };
      edges.set(id, merged);
      emit();
      return merged;
    },
    deleteEdge: (id) => {
      if (edges.delete(id)) emit();
    },
    subscribe: (fn) => {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
  };
}
