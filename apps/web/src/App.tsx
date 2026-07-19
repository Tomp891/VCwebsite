import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createLocalStore, Editor } from "@atlas/editor";
import { Graph2D } from "@atlas/graph";
import { SuggestionsPanel } from "@atlas/ai";
import { DatabaseView, NavTree, allTags, blockTags } from "@atlas/db";
import {
  ChatPanel,
  createRetriever,
  DEFAULT_TOP_K,
  classifyScope,
  type RetrieverOptions,
} from "@atlas/rag";
import type { EditorStore, Retriever } from "@atlas/contracts";
import { useRagEngine } from "./ai/useRagEngine.js";
import { storeToGraphData } from "./graphData.js";
import { DataSafety } from "./DataSafety.js";
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

// How wide a net the "Ask" retrieval casts, inferred from the question itself.
const BROAD_TOP_K = 12;
const TAG_SCOPE_CAP = 20;

// Retrieval tuning shared across every Ask query (blended vector + lexical +
// graph-importance, MMR-diversified, with confidence-gated 1-hop expansion).
const RETRIEVER_TUNING = {
  rankWeight: 0.25,
  lexicalWeight: 0.35,
  mmrLambda: 0.7,
  minEdgeConfidence: 0.3,
  maxNeighboursPerSeed: 3,
} as const;

/** An EditorStore view narrowed to a subset of block ids (for tag-scoped Ask). */
function scopedStore(base: EditorStore, allow: Set<string>): EditorStore {
  return {
    ...base,
    listBlocks: () => base.listBlocks().filter((b) => allow.has(b.id)),
    listEdges: () =>
      base
        .listEdges()
        .filter((e) => allow.has(e.srcBlockId) && allow.has(e.dstBlockId)),
  };
}

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

  // AI engine (local Ollama with mock fallback) shared by suggestions + Ask.
  const ai = useAiProvider();
  // Cached embedding index + graph ranker + clusters + theme summaries, kept
  // warm and re-synced (only changed blocks re-embed) as the store mutates.
  const rag = useRagEngine(ai.provider, ai.config, store.listBlocks(), version);
  const ragRef = useRef(rag);
  ragRef.current = rag;
  // Adaptive-scope retrieval: the question decides how wide to look. Mentioning
  // an existing tag scopes to those notes; an embedding-based intent classifier
  // (paraphrase-aware, EN/NL) widens broad/overview questions and routes them
  // across topic clusters; otherwise the default small top-K.
  const retriever = useMemo<Retriever>(
    () => ({
      async retrieve(query: string) {
        const { index, ranker, clusters } = ragRef.current;
        const base: RetrieverOptions = { ...RETRIEVER_TUNING, index, ranker };
        const q = query.toLowerCase();
        const mentioned = allTags(store.listBlocks()).filter((t) =>
          q.includes(t.toLowerCase()),
        );
        if (mentioned.length > 0) {
          const active = new Set(mentioned);
          const allow = new Set(
            store
              .listBlocks()
              .filter((b) => blockTags(b).some((t) => active.has(t)))
              .map((b) => b.id),
          );
          if (allow.size > 0) {
            const k = Math.min(allow.size, TAG_SCOPE_CAP);
            return createRetriever(scopedStore(store, allow), ai.provider, {
              ...base,
              topK: k,
            }).retrieve(query);
          }
        }
        const scope = await classifyScope(query, {
          embed: (texts) => ai.provider.embed(texts),
        });
        const broad = scope === "broad";
        const topK = broad
          ? Math.min(store.listBlocks().length, BROAD_TOP_K)
          : DEFAULT_TOP_K;
        const routing =
          broad && clusters ? { clusters, perClusterK: 2 } : {};
        return createRetriever(store, ai.provider, {
          ...base,
          topK,
          ...routing,
        }).retrieve(query);
      },
    }),
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

  // Deterministic answers for structural/meta questions ("how many notes?",
  // "which tags?"). Counting is not something a small LLM does reliably, so we
  // answer these straight from the store and skip the model entirely.
  const answerMeta = useCallback((query: string): string | null => {
    const q = query.toLowerCase();
    const dutch = /\b(hoeveel|aantal|welke|notities|blokken|pagina|verbinding)/.test(q);
    const bs = store.listBlocks();
    const es = store.listEdges();
    const pages = bs.filter((b) => b.parentId === null).length;
    const tags = allTags(bs);

    const asksCount = /\b(how many|how much|number of|count|total|hoeveel|aantal|totaal)\b/.test(q);
    const mentions = (re: RegExp) => re.test(q);

    // "which/what tags exist" or "list tags"
    if (
      mentions(/tags?\b/) &&
      (mentions(/\b(which|what|list|welke|toon|noem)\b/) || (asksCount && mentions(/tags?/)))
    ) {
      if (asksCount && !mentions(/\b(which|what|welke|list|toon|noem)\b/)) {
        return dutch
          ? `Je database bevat ${tags.length} tags.`
          : `Your database has ${tags.length} tags.`;
      }
      const list = tags.map((t) => `#${t}`).join(", ") || (dutch ? "geen" : "none");
      return dutch
        ? `Er zijn ${tags.length} tags: ${list}.`
        : `There are ${tags.length} tags: ${list}.`;
    }

    if (asksCount && mentions(/\b(links?|edges?|verbinding|connectie|relatie)/)) {
      return dutch
        ? `Er zijn ${es.length} links (verbindingen) in je database.`
        : `Your database has ${es.length} links (edges).`;
    }

    if (asksCount && mentions(/\b(notes?|notities|blokken|blocks|pagina|pages?)\b/)) {
      const pageWord = mentions(/\b(pagina|pages?)\b/) && !mentions(/\b(notes?|notities|blokken|blocks)\b/);
      if (pageWord) {
        return dutch
          ? `Je database bevat ${pages} pagina's.`
          : `Your database has ${pages} pages.`;
      }
      return dutch
        ? `Je database bevat ${bs.length} notes/blokken (waarvan ${pages} top-level pagina's).`
        : `Your database has ${bs.length} notes/blocks (${pages} of them top-level pages).`;
    }

    return null;
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

        <DataSafety store={store} version={version} />
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
          deepProvider={ai.deepProvider}
          onPath={setPath}
          onSelect={setSelectedId}
          getOverview={getChatOverview}
          metaAnswer={answerMeta}
          getThemes={() => ragRef.current.themeSummaries}
        />
      </aside>
    </div>
  );
}
