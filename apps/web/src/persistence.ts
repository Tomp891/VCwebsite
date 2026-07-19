import type { Block, Edge, EditorStore } from "@atlas/contracts";
import { STORAGE_KEYS } from "@atlas/editor";

/** Bumped whenever the export shape changes; `migrate` upgrades older files. */
export const CURRENT_EXPORT_VERSION = 2;

/** localStorage key the Ask panel persists its chat backlog under. */
const CHAT_HISTORY_KEY = "atlas.chat.history";
/** Rolling local snapshots so a bad import or cleared tab is recoverable. */
const BACKUPS_KEY = "atlas.backups";
const MAX_BACKUPS = 5;

export interface AtlasExport {
  version: number;
  exportedAt: string;
  blocks: Block[];
  edges: Edge[];
  /** Ask-panel backlog; optional so v1 files (blocks/edges only) still import. */
  chatHistory?: unknown[];
}

function isBlockArray(x: unknown): x is Block[] {
  return Array.isArray(x) && x.every((b) => b && typeof b === "object" && typeof (b as Block).id === "string");
}

function readChatHistory(): unknown[] {
  try {
    const raw = localStorage.getItem(CHAT_HISTORY_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Read the currently-persisted knowledge base straight from localStorage. */
function readPersistedPayload(): AtlasExport {
  const readArray = (key: string): unknown[] => {
    try {
      const raw = localStorage.getItem(key);
      const parsed = raw ? (JSON.parse(raw) as unknown) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };
  return {
    version: CURRENT_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    blocks: readArray(STORAGE_KEYS.blocks) as Block[],
    edges: readArray(STORAGE_KEYS.edges) as Edge[],
    chatHistory: readChatHistory(),
  };
}

/** Snapshot the currently-persisted data (no live store needed). */
function backupPersisted(reason: string): void {
  const payload = readPersistedPayload();
  if (payload.blocks.length === 0) return;
  const backups = readBackups();
  const meta: StoredBackup = {
    id: `bk-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    at: Date.now(),
    reason,
    blocks: payload.blocks.length,
    payload,
  };
  writeBackups([meta, ...backups]);
}

/** Serialize the whole store (notes + chat backlog) to a portable payload. */
export function serializeStore(store: EditorStore): AtlasExport {
  return {
    version: CURRENT_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    blocks: store.listBlocks(),
    edges: store.listEdges(),
    chatHistory: readChatHistory(),
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

/**
 * Upgrade any historical export shape to the current one. v1 had only
 * blocks/edges; later versions may add fields, always kept backward-compatible.
 */
function migrate(parsed: Partial<AtlasExport>): AtlasExport {
  if (!isBlockArray(parsed.blocks) || !Array.isArray(parsed.edges)) {
    throw new Error("Not a valid Atlas export (missing blocks/edges).");
  }
  return {
    version: CURRENT_EXPORT_VERSION,
    exportedAt: typeof parsed.exportedAt === "string" ? parsed.exportedAt : new Date().toISOString(),
    blocks: parsed.blocks,
    edges: parsed.edges as Edge[],
    chatHistory: Array.isArray(parsed.chatHistory) ? parsed.chatHistory : [],
  };
}

/** Write a full snapshot into localStorage without touching the live store. */
function applyPayload(payload: AtlasExport): void {
  localStorage.setItem(STORAGE_KEYS.blocks, JSON.stringify(payload.blocks));
  localStorage.setItem(STORAGE_KEYS.edges, JSON.stringify(payload.edges));
  if (payload.chatHistory) {
    localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(payload.chatHistory));
  }
}

export interface BackupMeta {
  id: string;
  at: number;
  reason: string;
  blocks: number;
}

interface StoredBackup extends BackupMeta {
  payload: AtlasExport;
}

function readBackups(): StoredBackup[] {
  try {
    const raw = localStorage.getItem(BACKUPS_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? (parsed as StoredBackup[]) : [];
  } catch {
    return [];
  }
}

/** Persist the backup list, dropping oldest entries until it fits the quota. */
function writeBackups(backups: StoredBackup[]): void {
  let list = backups.slice(0, MAX_BACKUPS);
  while (list.length > 0) {
    try {
      localStorage.setItem(BACKUPS_KEY, JSON.stringify(list));
      return;
    } catch {
      // Over quota — drop the oldest snapshot and retry.
      list = list.slice(0, -1);
    }
  }
  try {
    localStorage.removeItem(BACKUPS_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Snapshot the current knowledge base into the rolling local backup list.
 * Skips a snapshot identical to the newest one so repeated saves don't churn.
 * Returns the new backup's metadata, or null when there is nothing to back up.
 */
export function createBackup(store: EditorStore, reason = "manual"): BackupMeta | null {
  const payload = serializeStore(store);
  if (payload.blocks.length === 0) return null;
  const backups = readBackups();
  const prev = backups[0];
  if (prev && JSON.stringify(prev.payload.blocks) === JSON.stringify(payload.blocks) &&
      JSON.stringify(prev.payload.edges) === JSON.stringify(payload.edges)) {
    return prev;
  }
  const meta: StoredBackup = {
    id: `bk-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    at: Date.now(),
    reason,
    blocks: payload.blocks.length,
    payload,
  };
  writeBackups([meta, ...backups]);
  return { id: meta.id, at: meta.at, reason: meta.reason, blocks: meta.blocks };
}

/** Metadata for every stored backup, newest first (without the heavy payload). */
export function listBackups(): BackupMeta[] {
  return readBackups().map(({ id, at, reason, blocks }) => ({ id, at, reason, blocks }));
}

/** Timestamp of the most recent backup, or null when none exist. */
export function lastBackupAt(): number | null {
  return readBackups()[0]?.at ?? null;
}

/** Restore a stored backup into the live store and reload. Throws if missing. */
export function restoreBackup(id: string): void {
  const backup = readBackups().find((b) => b.id === id);
  if (!backup) throw new Error("Backup not found.");
  // Snapshot what's about to be replaced so a restore is itself reversible.
  try {
    backupPersisted("before-restore");
  } catch {
    /* a failed snapshot must not block a valid restore */
  }
  applyPayload(migrate(backup.payload));
  location.reload();
}

/**
 * Replace the persisted store with an exported payload and reload so every pane
 * reads the fresh data. Snapshots the current data into the backup list first,
 * so a mistaken import is always recoverable. Throws on a malformed file.
 */
export function importFromJson(text: string, currentStore?: EditorStore): void {
  const payload = migrate(JSON.parse(text) as Partial<AtlasExport>);
  // Safety net: back up what is about to be overwritten (best-effort).
  try {
    if (currentStore) createBackup(currentStore, "before-import");
  } catch {
    /* a failed backup must not block a valid import */
  }
  applyPayload(payload);
  location.reload();
}
