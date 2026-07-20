/**
 * Live sync to a local file via the File System Access API.
 *
 * Lets Atlas continuously mirror the knowledge base to a JSON file the user
 * picks once (e.g. `atlas-live.json`). A local MCP server watches that file, so
 * an MCP client (Claude Desktop) always sees the current notes — fully local, no
 * network, no API key. Falls back gracefully in browsers without the API.
 */
import type { EditorStore } from "@atlas/contracts";
import { serializeStore } from "./persistence.js";

type PermState = "granted" | "denied" | "prompt";

/** Minimal subset of the File System Access API we rely on. */
export interface LiveFileHandle {
  name: string;
  createWritable(): Promise<{
    write(data: string): Promise<void>;
    close(): Promise<void>;
  }>;
  queryPermission?(descriptor: { mode: "readwrite" }): Promise<PermState>;
  requestPermission?(descriptor: { mode: "readwrite" }): Promise<PermState>;
}

interface SaveFilePicker {
  showSaveFilePicker(options?: {
    suggestedName?: string;
    types?: { description: string; accept: Record<string, string[]> }[];
  }): Promise<LiveFileHandle>;
}

function picker(): SaveFilePicker | null {
  const w = window as unknown as Partial<SaveFilePicker>;
  return typeof w.showSaveFilePicker === "function" ? (w as SaveFilePicker) : null;
}

/** True when this browser can live-sync to a chosen local file. */
export function supportsLiveSync(): boolean {
  return picker() !== null;
}

/** Prompt the user to choose/create the live file. Returns null if unsupported. */
export async function pickLiveFile(): Promise<LiveFileHandle | null> {
  const p = picker();
  if (!p) return null;
  return p.showSaveFilePicker({
    suggestedName: "atlas-live.json",
    types: [
      { description: "Atlas live data", accept: { "application/json": [".json"] } },
    ],
  });
}

/** Ensure we still hold readwrite permission on the handle. */
async function ensurePermission(handle: LiveFileHandle): Promise<boolean> {
  const desc = { mode: "readwrite" } as const;
  if (handle.queryPermission && (await handle.queryPermission(desc)) === "granted") {
    return true;
  }
  if (handle.requestPermission) {
    return (await handle.requestPermission(desc)) === "granted";
  }
  return true;
}

/** Write the current knowledge base to the live file. */
export async function writeLiveFile(
  handle: LiveFileHandle,
  store: EditorStore,
): Promise<void> {
  if (!(await ensurePermission(handle))) {
    throw new Error("Permission to write the live file was denied.");
  }
  const writable = await handle.createWritable();
  await writable.write(JSON.stringify(serializeStore(store), null, 2));
  await writable.close();
}
