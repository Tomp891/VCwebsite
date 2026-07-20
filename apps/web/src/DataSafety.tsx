import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import type { EditorStore } from "@atlas/contracts";
import {
  downloadExport,
  importFromJson,
  createBackup,
  listBackups,
  restoreBackup,
  type BackupMeta,
} from "./persistence.js";
import {
  pickLiveFile,
  supportsLiveSync,
  writeLiveFile,
  type LiveFileHandle,
} from "./liveSync.js";

/** Auto-backup at most this often (ms) while the user keeps editing. */
const AUTO_BACKUP_INTERVAL = 5 * 60 * 1000;
/** Debounce after the last edit before taking an auto-backup (ms). */
const AUTO_BACKUP_DEBOUNCE = 20 * 1000;

function ago(at: number): string {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export interface DataSafetyProps {
  store: EditorStore;
  /** Bumps on every store mutation; drives the auto-backup + indicator. */
  version: number;
}

/**
 * Local-first data-safety controls: export/import, on-demand + throttled
 * automatic local backups, and a restore list. Makes it visible that notes
 * live in this browser and are recoverable after a bad import or cleared tab.
 */
export function DataSafety({ store, version }: DataSafetyProps): JSX.Element {
  const fileRef = useRef<HTMLInputElement>(null);
  const [backups, setBackups] = useState<BackupMeta[]>(() => listBackups());
  const [open, setOpen] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const lastAuto = useRef<number>(backups[0]?.at ?? 0);
  const liveHandle = useRef<LiveFileHandle | null>(null);
  const [liveName, setLiveName] = useState<string | null>(null);

  const refresh = useCallback(() => setBackups(listBackups()), []);

  const startLiveSync = useCallback(async () => {
    try {
      const handle = await pickLiveFile();
      if (!handle) return;
      liveHandle.current = handle;
      await writeLiveFile(handle, store);
      setLiveName(handle.name);
    } catch (err) {
      // AbortError = user cancelled the picker; ignore.
      if (err instanceof DOMException && err.name === "AbortError") return;
      alert(`Live sync failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [store]);

  const stopLiveSync = useCallback(() => {
    liveHandle.current = null;
    setLiveName(null);
  }, []);

  // Mirror the store to the live file after each edit while live sync is on.
  useEffect(() => {
    const handle = liveHandle.current;
    if (!handle) return;
    const t = setTimeout(() => {
      void writeLiveFile(handle, store).catch(() => {
        // Lost access (revoked permission / removed file): stop silently.
        liveHandle.current = null;
        setLiveName(null);
      });
    }, 800);
    return () => clearTimeout(t);
  }, [version, store]);

  const backupNow = useCallback(
    (reason = "manual") => {
      const meta = createBackup(store, reason);
      if (meta) {
        lastAuto.current = meta.at;
        refresh();
      }
      return meta;
    },
    [store, refresh],
  );

  // Throttled + debounced auto-backup: wait for a lull in edits, and take at
  // most one snapshot per AUTO_BACKUP_INTERVAL.
  useEffect(() => {
    const t = setTimeout(() => {
      if (Date.now() - lastAuto.current >= AUTO_BACKUP_INTERVAL) {
        backupNow("auto");
      }
    }, AUTO_BACKUP_DEBOUNCE);
    return () => clearTimeout(t);
  }, [version, backupNow]);

  const onImportFile = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      file
        .text()
        .then((text) => importFromJson(text, store))
        .catch((err) =>
          alert(`Import failed: ${err instanceof Error ? err.message : String(err)}`),
        );
      e.target.value = "";
    },
    [store],
  );

  const onRestore = useCallback((id: string) => {
    if (confirm("Restore this backup? Your current notes will be snapshotted first, then replaced.")) {
      restoreBackup(id);
    }
  }, []);

  const last = backups[0]?.at ?? null;

  return (
    <div className="io-bar">
      <div className="io-safety" title="Your notes live in this browser's local storage. Export or back up regularly.">
        <span className="io-dot" />
        {last ? `Backed up ${ago(last)}` : "No backup yet"}
      </div>
      <div className="io-row">
        <button className="io-btn" onClick={() => downloadExport(store)} title="Download all notes + chat as JSON">
          Export
        </button>
        <button className="io-btn" onClick={() => fileRef.current?.click()} title="Replace notes from a JSON file (a backup is taken first)">
          Import
        </button>
        <button
          className="io-btn"
          onClick={() => {
            const meta = backupNow("manual");
            setFlash(meta ? "Backed up" : "Nothing to back up");
            setTimeout(() => setFlash(null), 1500);
          }}
          title="Take a local snapshot you can restore later"
        >
          {flash ?? "Backup"}
        </button>
        {backups.length > 0 && (
          <button className="io-btn" onClick={() => setOpen((o) => !o)} title="Restore a previous local backup">
            Restore ▾
          </button>
        )}
        {supportsLiveSync() &&
          (liveName ? (
            <button
              className="io-btn io-btn-live"
              onClick={stopLiveSync}
              title={`Live-syncing to ${liveName} for the local MCP server. Click to stop.`}
            >
              ● Live: {liveName}
            </button>
          ) : (
            <button
              className="io-btn"
              onClick={() => void startLiveSync()}
              title="Continuously mirror your notes to a local file the Atlas MCP server can read (for Claude Desktop)."
            >
              Live sync…
            </button>
          ))}
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          style={{ display: "none" }}
          onChange={onImportFile}
        />
      </div>
      {open && backups.length > 0 && (
        <ul className="io-backups">
          {backups.map((b) => (
            <li key={b.id} className="io-backup">
              <button className="io-backup-link" onClick={() => onRestore(b.id)} title={new Date(b.at).toLocaleString()}>
                <span className="io-backup-when">{ago(b.at)}</span>
                <span className="io-backup-meta">
                  {b.blocks} blocks · {b.reason}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
