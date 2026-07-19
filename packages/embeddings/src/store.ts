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
const DB_VERSION = 1;

function getIndexedDB(): IDBFactory | undefined {
  return typeof indexedDB !== "undefined" ? indexedDB : undefined;
}

function openDB(idb: IDBFactory, dbName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let req: IDBOpenDBRequest;
    try {
      req = idb.open(dbName, DB_VERSION);
    } catch (err) {
      reject(err);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "blockId" });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // Don't let this connection block a future upgrade from another tab.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    // A blocked open (older connection still open) is treated as a failure so
    // the store degrades to memory-only rather than hanging forever.
    req.onblocked = () => reject(req.error ?? new Error("indexedDB open blocked"));
  });
}

export interface IndexedDBStoreOptions {
  dbName?: string;
}

/** Mutation applied inside a readwrite transaction against the records store. */
type WriteOp = (store: IDBObjectStore) => void;

/**
 * IndexedDB-backed store with a synchronous in-memory mirror. Reads are served
 * from memory; writes update memory immediately and are flushed to IndexedDB in
 * the background. If IndexedDB is missing (e.g. Node without a shim) — or if it
 * fails at runtime (private-mode quota, corrupted db, blocked upgrade) — it
 * behaves exactly like the memory store: reads/writes keep working in memory
 * and durable persistence is silently skipped.
 */
export function createIndexedDBStore(options: IndexedDBStoreOptions = {}): EmbeddingStore {
  const dbName = options.dbName ?? DB_NAME;
  const mem = createMemoryStore();
  const idb = getIndexedDB();

  /** Set once IndexedDB proves unusable; from then on we stay memory-only. */
  let disabled = idb === undefined;
  let dbPromise: Promise<IDBDatabase | undefined> | undefined;

  function db(): Promise<IDBDatabase | undefined> {
    if (disabled || !idb) return Promise.resolve(undefined);
    if (!dbPromise) {
      dbPromise = openDB(idb, dbName).catch(() => {
        disabled = true;
        return undefined;
      });
    }
    return dbPromise;
  }

  /** Run one mutation in its own transaction, resolving on durable commit. */
  function runTransaction(database: IDBDatabase, op: WriteOp): Promise<void> {
    return new Promise((resolve, reject) => {
      let tx: IDBTransaction;
      try {
        tx = database.transaction(STORE_NAME, "readwrite");
      } catch (err) {
        reject(err);
        return;
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error("indexedDB transaction aborted"));
      try {
        op(tx.objectStore(STORE_NAME));
      } catch (err) {
        try {
          tx.abort();
        } catch {
          /* ignore — the reject below is what matters */
        }
        reject(err);
      }
    });
  }

  // Background writes are serialized on a single promise chain so they apply in
  // call order and a failure in one never rejects (or reorders) later writes.
  let chain: Promise<void> = Promise.resolve();

  function enqueue(op: WriteOp): void {
    if (disabled || !idb) return;
    chain = chain.then(async () => {
      const database = await db();
      if (!database) return;
      try {
        await runTransaction(database, op);
      } catch {
        // A single failed flush must not break the in-memory mirror or block
        // subsequent writes; durable state is best-effort.
      }
    });
  }

  return {
    async hydrate() {
      const database = await db();
      if (!database) return;
      try {
        const records = await new Promise<EmbeddingRecord[]>((resolve, reject) => {
          let tx: IDBTransaction;
          try {
            tx = database.transaction(STORE_NAME, "readonly");
          } catch (err) {
            reject(err);
            return;
          }
          const req = tx.objectStore(STORE_NAME).getAll();
          req.onsuccess = () => resolve((req.result as EmbeddingRecord[]) ?? []);
          req.onerror = () => reject(req.error);
          tx.onabort = () => reject(tx.error ?? new Error("indexedDB hydrate aborted"));
        });
        for (const r of records) mem.put(r);
      } catch {
        // Reads failed — keep whatever is already in memory and carry on.
      }
    },
    get: mem.get,
    all: mem.all,
    has: mem.has,
    keys: mem.keys,
    put: (record) => {
      mem.put(record);
      enqueue((os) => {
        os.put(record);
      });
    },
    delete: (id) => {
      mem.delete(id);
      enqueue((os) => {
        os.delete(id);
      });
    },
    clear: () => {
      mem.clear();
      enqueue((os) => {
        os.clear();
      });
    },
  };
}
