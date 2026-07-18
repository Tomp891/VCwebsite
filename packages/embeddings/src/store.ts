/**
 * (c) Persistence layer.
 *
 * A store keeps embedding records in an in-memory map for synchronous reads
 * (the EmbeddingIndex contract's `get`/`all`/`nearest`/`similarity` are sync)
 * and mirrors writes to durable storage. Two implementations:
 *   - createMemoryStore: pure in-memory, used in tests / SSR / fallback.
 *   - createIndexedDBStore: IndexedDB-backed, hydrated once then written-through,
 *     falling back to memory-only when IndexedDB is unavailable.
 */

import type { BlockId, EmbeddingRecord } from "@atlas/contracts";

export interface EmbeddingStore {
  /** load durable records into memory; no-op for the memory store. */
  hydrate(): Promise<void>;
  get(id: BlockId): EmbeddingRecord | undefined;
  all(): EmbeddingRecord[];
  has(id: BlockId): boolean;
  keys(): BlockId[];
  put(record: EmbeddingRecord): void;
  delete(id: BlockId): void;
  clear(): void;
}

/** In-memory store. Deterministic, synchronous, no persistence. */
export function createMemoryStore(): EmbeddingStore {
  const map = new Map<BlockId, EmbeddingRecord>();
  return {
    async hydrate() {
      /* nothing to load */
    },
    get: (id) => map.get(id),
    all: () => [...map.values()],
    has: (id) => map.has(id),
    keys: () => [...map.keys()],
    put: (record) => {
      map.set(record.blockId, record);
    },
    delete: (id) => {
      map.delete(id);
    },
    clear: () => map.clear(),
  };
}

const DB_NAME = "atlas-embeddings";
const STORE_NAME = "records";

function getIndexedDB(): IDBFactory | undefined {
  return typeof indexedDB !== "undefined" ? indexedDB : undefined;
}

function openDB(idb: IDBFactory, dbName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = idb.open(dbName, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "blockId" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export interface IndexedDBStoreOptions {
  dbName?: string;
}

/**
 * IndexedDB-backed store with a synchronous in-memory mirror. Reads are served
 * from memory; writes update memory immediately and are flushed to IndexedDB in
 * the background. If IndexedDB is missing (e.g. Node without a shim) it behaves
 * exactly like the memory store.
 */
export function createIndexedDBStore(options: IndexedDBStoreOptions = {}): EmbeddingStore {
  const dbName = options.dbName ?? DB_NAME;
  const mem = createMemoryStore();
  const idb = getIndexedDB();
  let dbPromise: Promise<IDBDatabase | undefined> | undefined;

  function db(): Promise<IDBDatabase | undefined> {
    if (!idb) return Promise.resolve(undefined);
    if (!dbPromise) dbPromise = openDB(idb, dbName).catch(() => undefined);
    return dbPromise;
  }

  function write(mode: "put" | "delete" | "clear", record?: EmbeddingRecord, id?: BlockId): void {
    if (!idb) return;
    void db().then((database) => {
      if (!database) return;
      const tx = database.transaction(STORE_NAME, "readwrite");
      const os = tx.objectStore(STORE_NAME);
      if (mode === "put" && record) os.put(record);
      else if (mode === "delete" && id !== undefined) os.delete(id);
      else if (mode === "clear") os.clear();
    });
  }

  return {
    async hydrate() {
      const database = await db();
      if (!database) return;
      const records: EmbeddingRecord[] = await new Promise((resolve, reject) => {
        const tx = database.transaction(STORE_NAME, "readonly");
        const req = tx.objectStore(STORE_NAME).getAll();
        req.onsuccess = () => resolve(req.result as EmbeddingRecord[]);
        req.onerror = () => reject(req.error);
      });
      for (const r of records) mem.put(r);
    },
    get: mem.get,
    all: mem.all,
    has: mem.has,
    keys: mem.keys,
    put: (record) => {
      mem.put(record);
      write("put", record);
    },
    delete: (id) => {
      mem.delete(id);
      write("delete", undefined, id);
    },
    clear: () => {
      mem.clear();
      write("clear");
    },
  };
}
