import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ChangeEvent } from "react";
import { createLocalStore, Editor } from "@atlas/editor";
import { Graph2D } from "@atlas/graph";
import { SuggestionsPanel } from "@atlas/ai";
import { DatabaseView, NavTree, allTags, blockTags } from "@atlas/db";
import { ChatPanel, createRetriever } from "@atlas/rag";
import { storeToGraphData } from "./graphData.js";
import { downloadExport, importFromJson } from "./persistence.js";
import { LinksPanel } from "./LinksPanel.js";
import { GraphPreview } from "./GraphPreview.js";
import { EmergentPanel } from "./emergent/EmergentPanel.js";
import { AiSettings } from "./ai/AiSettings.js";
import { useAiProvider } from "./ai/useAiProvider.js";

// 3D pulls in three.js + 3d-force-graph (~large). Load it only when the Atlas
// mode is opened so the initial bundle stays small.
const Graph3D = lazy(() =>
  import("@atlas/graph3d").then((m) => ({ default: m.Graph3D })),
);

// Shared singleton — the ONE substrate every pane reads/writes.
const store = createLocalStore();

// Human-readable names for the tag-derived graph clusters.
const CLUSTER_LABELS: Record<number, string> = {
  0: "Graph & PKM",
  1: "AI & Design",
  2: "Architecture",
};

type CenterTab = "page" | "database";
type GraphMode = "2d" | "3d" | "emergent";

export function App() {
  // Re-render on any store change so graph/nav/db stay in sync. We keep a
  // monotonic mutation counter (not a block/edge count) so prop-only edits —
  // e.g. changing a page's tags — also invalidate the derived memos below.
  const [version, setVersion] = useState(0);
  useEffect(() => store.subscribe(() => setVersion((v) => v + 1)), []);

  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [path, setPath] = useState<string[]>([]);
  const [centerTab, setCenterTab] = useState<CenterTab>("page");
  const [graphMode, setGraphMode] = useState<GraphMode>("2d");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  // AI engine (local Ollama with mock fallback) shared by suggestions + Ask.
  const ai = useAiProvider();
  const retriever = useMemo(
    () => createRetriever(store, ai.provider),
    [ai.provider],
  );

  // Compact meta-summary of the whole store, injected into each chat prompt so
  // the model can answer questions about the database itself (counts, tags).
  const getChatOverview = useCallback(() => {
    const bs = store.listBlocks();
    const es = store.listEdges();
    const pages = bs.filter((b) => b.parentId === null).length;
    const explicit = es.filter((e) => e.tier === "explicit").length;
    const tags = allTags(bs);
    return [
      `Total notes/blocks: ${bs.length} (top-level pages: ${pages}).`,
      `Total links: ${es.length} (${explicit} explicit/human, ${es.length - explicit} inferred).`,
      `Tags (${tags.length}): ${tags.map((t) => `#${t}`).join(", ") || "none"}.`,
    ].join("\n");
  }, []);

  const toggleTag = useCallback((tag: string) => {
    setActiveTags((cur) =>
      cur.includes(tag) ? cur.filter((t) => t !== tag) : [...cur, tag],
    );
  }, []);

  // Expand the graph to fill the browser window. We use a fixed-overlay
  // (not the native Fullscreen API) because react-force-graph's canvas stops
  // painting when resized inside a native-fullscreen element.
  const toggleFullscreen = useCallback(() => setIsFullscreen((v) => !v), []);

  // Click-through from a graph node preview to the full page in the editor.
  const openSelectedPage = useCallback(() => {
    setCenterTab("page");
    setIsFullscreen(false);
  }, []);

  // Esc leaves the expanded view.
  useEffect(() => {
    if (!isFullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsFullscreen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isFullscreen]);

  const blocks = useMemo(() => store.listBlocks(), [version]);
  const graphData = useMemo(
    () => storeToGraphData(blocks, store.listEdges()),
    [blocks],
  );

  // Every tag in the store + a lookup of tags per block, for filtering.
  const allTagList = useMemo(() => allTags(store.listBlocks()), [version]);
  const tagsByBlock = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const b of store.listBlocks()) m.set(b.id, blockTags(b));
    return m;
  }, [version]);

  // The graph, narrowed to nodes carrying an active tag (and edges between
  // those nodes). No active tags = show everything.
  const filteredGraphData = useMemo(() => {
    if (activeTags.length === 0) return graphData;
    const active = new Set(activeTags);
    const visible = new Set(
      graphData.nodes
        .filter((n) => (tagsByBlock.get(n.id) ?? []).some((t) => active.has(t)))
        .map((n) => n.id),
    );
    // react-force-graph may mutate link endpoints from ids to node objects.
    const endId = (e: unknown): string =>
      typeof e === "string" ? e : ((e as { id: string }).id ?? "");
    return {
      nodes: graphData.nodes.filter((n) => visible.has(n.id)),
      links: graphData.links.filter(
        (l) => visible.has(endId(l.source)) && visible.has(endId(l.target)),
      ),
    };
  }, [graphData, activeTags, tagsByBlock]);

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
        <NavTree
          store={store}
          activeId={selectedPageId}
          onOpen={setSelectedId}
          activeTags={activeTags}
          onTagToggle={toggleTag}
        />

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
            <button
              className={graphMode === "emergent" ? "seg-btn active" : "seg-btn"}
              onClick={() => setGraphMode("emergent")}
              title="Emergent themes — hulls, ranking and temporal playback"
            >
              Emergent
            </button>
            <button
              className="seg-btn"
              onClick={toggleFullscreen}
              title={isFullscreen ? "Exit fullscreen" : "View graph fullscreen"}
              aria-label={isFullscreen ? "Exit fullscreen" : "View graph fullscreen"}
            >
              {isFullscreen ? "Exit" : "Fullscreen"}
            </button>
          </div>
        </div>
        <div className={isFullscreen ? "graph-frame is-fullscreen" : "graph-frame"}>
          {graphMode !== "emergent" && allTagList.length > 0 && (
            <div className="graph-filter" role="group" aria-label="Filter graph by tag">
              {allTagList.map((t) => (
                <button
                  key={t}
                  type="button"
                  className={activeTags.includes(t) ? "tag-chip active" : "tag-chip"}
                  aria-pressed={activeTags.includes(t)}
                  onClick={() => toggleTag(t)}
                >
                  #{t}
                </button>
              ))}
              {activeTags.length > 0 && (
                <button
                  type="button"
                  className="tag-chip tag-chip--clear"
                  onClick={() => setActiveTags([])}
                  title="Clear tag filters"
                >
                  Clear
                </button>
              )}
            </div>
          )}
          {graphMode === "2d" && (
            <Graph2D
              data={filteredGraphData}
              selectedId={selectedId}
              onSelect={setSelectedId}
              clusterLabels={CLUSTER_LABELS}
            />
          )}
          {graphMode === "3d" && (
            <Suspense fallback={<div className="graph-loading">Unfolding the atlas…</div>}>
              <Graph3D data={filteredGraphData} selectedId={selectedId} onSelect={setSelectedId} />
            </Suspense>
          )}
          {graphMode === "emergent" && (
            <EmergentPanel
              blocks={blocks}
              version={version}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          )}
          {selectedPageId && (
            <GraphPreview
              store={store}
              pageId={selectedPageId}
              version={version}
              onOpen={openSelectedPage}
              onClose={() => setSelectedId(undefined)}
            />
          )}
          {isFullscreen && (
            <button
              className="graph-fs-exit"
              onClick={toggleFullscreen}
              title="Exit fullscreen (Esc)"
            >
              Exit fullscreen
            </button>
          )}
        </div>

        <h2 className="pane-title" style={{ marginTop: 20 }}>
          Suggestions
        </h2>
        <SuggestionsPanel store={store} provider={ai.provider} />

        <h2 className="pane-title" style={{ marginTop: 20 }}>
          Inked links
        </h2>
        <LinksPanel store={store} version={version} onSelect={setSelectedId} />

        <h2 className="pane-title" style={{ marginTop: 20 }}>
          Ask
        </h2>
        <AiSettings state={ai} />
        <ChatPanel
          retriever={retriever}
          provider={ai.provider}
          onPath={setPath}
          onSelect={setSelectedId}
          getOverview={getChatOverview}
        />
      </aside>
    </div>
  );
}
