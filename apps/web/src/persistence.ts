import type { Block, Edge, EditorStore } from "@atlas/contracts";
import { STORAGE_KEYS } from "@atlas/editor";

interface AtlasExport {
  version: 1;
  exportedAt: string;
  blocks: Block[];
  edges: Edge[];
}

/** Serialize the whole store to a portable JSON payload. */
export function serializeStore(store: EditorStore): AtlasExport {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    blocks: store.listBlocks(),
    edges: store.listEdges(),
  };
}

/** Trigger a browser download of the current knowledge base as JSON. */
export function downloadExport(store: EditorStore): void {
  const payload = serializeStore(store);
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `atlas-export-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function isBlockArray(x: unknown): x is Block[] {
  return Array.isArray(x) && x.every((b) => b && typeof b === "object" && typeof (b as Block).id === "string");
}

/**
 * Replace the persisted store with an exported payload and reload so every pane
 * reads the fresh data. Writes the same localStorage keys the local store uses.
 * Throws on a malformed file.
 */
export function importFromJson(text: string): void {
  const parsed = JSON.parse(text) as Partial<AtlasExport>;
  if (!isBlockArray(parsed.blocks) || !Array.isArray(parsed.edges)) {
    throw new Error("Not a valid Atlas export (missing blocks/edges).");
  }
  localStorage.setItem(STORAGE_KEYS.blocks, JSON.stringify(parsed.blocks));
  localStorage.setItem(STORAGE_KEYS.edges, JSON.stringify(parsed.edges));
  location.reload();
}
