import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createLocalStore, Editor } from "@atlas/editor";
import { Graph2D } from "@atlas/graph";
import { Graph3D } from "@atlas/graph3d";
import { createMockProvider, SuggestionsPanel } from "@atlas/ai";
import { DatabaseView, NavTree } from "@atlas/db";
import { ChatPanel, createRetriever } from "@atlas/rag";
import { storeToGraphData } from "./graphData.js";

// Shared singletons — the ONE substrate every pane reads/writes.
const store = createLocalStore();
const provider = createMockProvider();
const retriever = createRetriever(store, provider);

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

  const graphData = useMemo(
    () => storeToGraphData(store.listBlocks(), store.listEdges()),
    [version],
  );

  // When GraphRAG returns a traversal path, highlight its first node.
  useEffect(() => {
    if (path.length > 0) setSelectedId(path[0]);
  }, [path]);

  return (
    <div className="app-shell">
      <aside className="pane pane-nav">
        <h1 className="brand">Atlas</h1>
        <div className="brand-sub">a cartography of thought</div>
        <NavTree store={store} onOpen={setSelectedId} />
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
          <Editor store={store} />
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
            <Graph2D data={graphData} selectedId={selectedId} onSelect={setSelectedId} />
          ) : (
            <Graph3D data={graphData} selectedId={selectedId} onSelect={setSelectedId} />
          )}
        </div>

        <h2 className="pane-title" style={{ marginTop: 20 }}>
          Suggestions
        </h2>
        <SuggestionsPanel store={store} provider={provider} />

        <h2 className="pane-title" style={{ marginTop: 20 }}>
          Ask
        </h2>
        <ChatPanel retriever={retriever} provider={provider} onPath={setPath} />
      </aside>
    </div>
  );
}
