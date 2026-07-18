import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { ChangeEvent } from "react";
import { createLocalStore, Editor } from "@atlas/editor";
import { Graph2D } from "@atlas/graph";
import { createMockProvider, SuggestionsPanel } from "@atlas/ai";
import { DatabaseView, NavTree } from "@atlas/db";
import { ChatPanel, createRetriever } from "@atlas/rag";
import { storeToGraphData } from "./graphData.js";
import { downloadExport, importFromJson } from "./persistence.js";
import { LinksPanel } from "./LinksPanel.js";

// 3D pulls in three.js + 3d-force-graph (~large). Load it only when the Atlas
// mode is opened so the initial bundle stays small.
const Graph3D = lazy(() =>
  import("@atlas/graph3d").then((m) => ({ default: m.Graph3D })),
);

// Shared singletons — the ONE substrate every pane reads/writes.
const store = createLocalStore();
const provider = createMockProvider();
const retriever = createRetriever(store, provider);

// Human-readable names for the tag-derived graph clusters.
const CLUSTER_LABELS: Record<number, string> = {
  0: "Graph & PKM",
  1: "AI & Design",
  2: "Architecture",
};

type CenterTab = "page" | "database";
type GraphMode = "2d" | "3d";

export function App() {
  // Re-render on any store change so graph/nav/db stay in sync.
  const version = useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.listBlocks().length + store.listEdges().length,
  );

  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [path, setPath] = useState<string[]>([]);
  const [centerTab, setCenterTab] = useState<CenterTab>("page");
  const [graphMode, setGraphMode] = useState<GraphMode>("2d");
  const fileRef = useRef<HTMLInputElement>(null);

  const graphData = useMemo(
    () => storeToGraphData(store.listBlocks(), store.listEdges()),
    [version],
  );

  // The page that owns the current selection (walk parentId), so selecting any
  // block/graph node opens its containing page in the editor.
  const selectedPageId = useMemo(() => {
    if (!selectedId) return undefined;
    let cur = store.getBlock(selectedId);
    const guard = new Set<string>();
    while (cur && cur.parentId !== null && !guard.has(cur.id)) {
      guard.add(cur.id);
      cur = store.getBlock(cur.parentId);
    }
    return cur?.id;
  }, [selectedId, version]);

  // When GraphRAG returns a traversal path, highlight its first node.
  useEffect(() => {
    if (path.length > 0) setSelectedId(path[0]);
  }, [path]);

  const onImportFile = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    file
      .text()
      .then(importFromJson)
      .catch((err) => alert(`Import failed: ${err instanceof Error ? err.message : String(err)}`));
    e.target.value = "";
  }, []);

  return (
    <div className="app-shell">
      <aside className="pane pane-nav">
        <h1 className="brand">Atlas</h1>
        <div className="brand-sub">a cartography of thought</div>
        <NavTree store={store} activeId={selectedPageId} onOpen={setSelectedId} />

        <div className="io-bar">
          <button className="io-btn" onClick={() => downloadExport(store)} title="Download all notes as JSON">
            Export
          </button>
          <button className="io-btn" onClick={() => fileRef.current?.click()} title="Replace notes from a JSON file">
            Import
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            style={{ display: "none" }}
            onChange={onImportFile}
          />
        </div>
      </aside>

      <main className="pane pane-editor">
        <div className="tabbar">
          <button
            className={centerTab === "page" ? "tab active" : "tab"}
            onClick={() => setCenterTab("page")}
          >
            Page
          </button>
          <button
            className={centerTab === "database" ? "tab active" : "tab"}
            onClick={() => setCenterTab("database")}
          >
            Database
          </button>
        </div>
        {centerTab === "page" ? (
          <Editor store={store} pageId={selectedPageId} onOpenPage={setSelectedId} />
        ) : (
          <DatabaseView store={store} title="All blocks" />
        )}
      </main>

      <aside className="pane pane-context">
        <div className="pane-title-row">
          <h2 className="pane-title">Graph</h2>
          <div className="seg">
            <button
              className={graphMode === "2d" ? "seg-btn active" : "seg-btn"}
              onClick={() => setGraphMode("2d")}
            >
              2D
            </button>
            <button
              className={graphMode === "3d" ? "seg-btn active" : "seg-btn"}
              onClick={() => setGraphMode("3d")}
            >
              3D Atlas
            </button>
          </div>
        </div>
        <div className="graph-frame">
          {graphMode === "2d" ? (
            <Graph2D
              data={graphData}
              selectedId={selectedId}
              onSelect={setSelectedId}
              clusterLabels={CLUSTER_LABELS}
            />
          ) : (
            <Suspense fallback={<div className="graph-loading">Unfolding the atlas…</div>}>
              <Graph3D data={graphData} selectedId={selectedId} onSelect={setSelectedId} />
            </Suspense>
          )}
        </div>

        <h2 className="pane-title" style={{ marginTop: 20 }}>
          Suggestions
        </h2>
        <SuggestionsPanel store={store} provider={provider} />

        <h2 className="pane-title" style={{ marginTop: 20 }}>
          Inked links
        </h2>
        <LinksPanel store={store} version={version} onSelect={setSelectedId} />

        <h2 className="pane-title" style={{ marginTop: 20 }}>
          Ask
        </h2>
        <ChatPanel retriever={retriever} provider={provider} onPath={setPath} />
      </aside>
    </div>
  );
}
