# Build Plan — AI Graph-Based Knowledge Management App

> Working codename: **Atlas** — a hybrid of Notion (structured docs/DBs), Logseq
> (block atomicity + bidirectional links), Obsidian (local-first ownership), and
> Mem (ambient AI), unified so that atomic blocks, a queryable knowledge graph,
> and AI all read/write the **same substrate**.

This is a pragmatic, phased plan. Each phase ships something usable. You do **not**
build it all before validating. The golden thread: *AI proposes, human disposes;
manual = ink, AI = pencil; the graph is always adjacent to the page.*

---

## 0. Product principles (the non-negotiables)

1. **One substrate.** Everything is a *block* with a stable ID. Pages, DB rows,
   and graph nodes are all views over blocks. No parallel data models.
2. **Local-first + user owns the files.** Plain Markdown + frontmatter on disk,
   sidecar index DB. Offline-capable, portable, trustworthy.
3. **Three edge tiers.** Explicit (human ink) · Inferred-accepted (promoted) ·
   Inferred-ambient (AI pencil, confidence-scored, never destructive).
4. **AI proposes, human disposes.** AI writes to a suggestion layer; canonical
   graph only changes on human confirmation (or an opt-in trust ratchet).
5. **Provenance everywhere.** Every AI edge/answer cites its source blocks.
6. **Reversibility.** Every AI action is one-click undoable and attributed.
7. **2D default, 3D as an opt-in "Atlas" mode** that earns its place (layered
   abstraction, spatial memory, temporal emergence).

---

## 1. Architecture overview

```
┌────────────────────────────────────────────────────────────────┐
│                          CLIENT (Tauri)                          │
│  UI (React/TS)        Editor          Graph renderer             │
│  3-pane workspace   block/outliner   three.js / 3d-force-graph   │
│        │                 │                    │                  │
│        └──────── local core (Rust) ───────────┘                 │
│   CRDT sync (Yjs/Automerge) · Markdown files on disk             │
│   local index: SQLite + FTS5 + sqlite-vec (or LanceDB)          │
│        │                                                         │
│   AI orchestrator (pluggable): Ollama (local) | OpenAI/Anthropic│
│     - embeddings, tag/link suggestion, dedup, summaries         │
│     - GraphRAG retrieval (vector + FTS + n-hop graph traversal) │
└────────────────────────────────────────────────────────────────┘
        │ (optional, for teams / cross-device sync)
┌────────────────────────────────────────────────────────────────┐
│                     SERVER (optional, later)                     │
│  Postgres + pgvector · sync relay · auth · shared spaces        │
└────────────────────────────────────────────────────────────────┘
```

### Data model (the 80%)
- **Block**: `{ id, parentId, order, type, content, props{}, createdAt, updatedAt }`
- **Page** = root block. **Database** = a saved query over block `props`.
- **Edge**: `{ id, srcBlockId, dstBlockId, type, tier, confidence, provenance, createdAt }`
  - `tier ∈ {explicit, inferred_accepted, inferred_ambient}`
  - `type ∈ {link, tag, ref, related, contradicts, supports, depends_on, ...}`
  - `provenance`: how it was derived (shared terms, cosine sim, co-citation, LLM)
- **Layer** (for graph): computed rollups — atoms → concepts (clusters) → domains.

### Why this stack
- **Tauri (Rust core)**: tiny footprint, real local files, native perf; better
  than Electron for a local-first ownership story.
- **Yjs/Automerge (CRDT)**: offline + real-time collab from the same primitive.
- **SQLite + FTS5 + sqlite-vec**: one embedded store for full-text + vectors +
  an edges table for the graph. LanceDB if vector scale demands it.
- **three.js + `3d-force-graph`**: fastest path to a scalable WebGL graph; 2D
  mode via the same lib or Sigma.js.
- **Pluggable AI**: local (Ollama) for privacy or API for quality — user choice.

---

## 2. Phased roadmap

### Phase 1 — Editor + local core (weeks 1–4) → *usable Logseq-like core*
**Goal:** you can write, and it's yours on disk.
- Tauri shell, 3-pane layout scaffold (nav / page / context — panes collapsible).
- Block model + Markdown-on-disk persistence + stable block IDs.
- Block/outliner editor: nesting, `/` commands, `[[wikilinks]]` autocomplete,
  `#tags`, block references (transclusion).
- Backlinks panel (explicit edges only).
- Local index: SQLite + FTS5 full-text search.
- **Exit criteria:** create/link/search notes; files readable in any editor.

### Phase 2 — Properties + databases (weeks 5–7) → *Notion axis*
**Goal:** structure without leaving the block model.
- Block properties (frontmatter + inline).
- Saved queries → table/board/list views ("databases" = queries over props).
- Filters, sorts, grouped views.
- **Exit criteria:** a "Projects" DB and a "Reading" DB from the same blocks.

### Phase 3 — Graph engine + 2D visualization (weeks 8–11) → *the graph does work*
**Goal:** a real, queryable, legible graph — not decoration.
- Edges table + graph queries (n-hop traversal; simple query language).
- 2D force-directed graph (`3d-force-graph` in 2D mode / Sigma): local graph in
  right pane (current page + n-hop), global graph as zoom-out.
- Visual encoding: node size = importance, color = community (Leiden), edge
  style = tier (solid = explicit).
- Semantic zoom + focus/context; bidirectional page↔graph selection sync.
- **Exit criteria:** navigate entirely via graph; local↔global feels continuous.

### Phase 4 — AI suggestion layer (weeks 12–16) → *manual + AI, safely*
**Goal:** dense graph without manual toil, without losing trust.
- Embeddings pipeline (on write): chunk → embed → store vectors.
- Inferred-ambient edges: related/similar, co-occurrence — shown as **pencil**
  (dashed/translucent, confidence = opacity), with provenance.
- Suggestion UI: accept/reject → accepted edges "ink in" (promote to explicit).
- AI tag suggestions, dedup/merge candidates (confirm-only), auto-summaries.
- **Trust ratchet:** per-category threshold to auto-promote once user consistently
  accepts. Everything reversible + attributed.
- **Exit criteria:** graph density from AI, canonical layer stays clean & trusted.

### Phase 5 — GraphRAG chat (weeks 17–20) → *substantive answers*
**Goal:** ask questions of your corpus with citations.
- Hybrid retrieval: vector + FTS + n-hop graph expansion from matched nodes.
- Answer panel cites source blocks; draws the traversal path on the graph.
- Local (Ollama) and API model options; provenance mandatory.
- **Exit criteria:** ask a cross-note question, get a cited, correct answer.

### Phase 6 — 3D "Atlas" mode + aesthetic (weeks 21–26) → *the differentiator*
**Goal:** the layered, emergent, "living cartography" experience.
- 3D multilayer graph (Z = abstraction: atoms → concepts → domains); peel/drill.
- Embedding-seeded layout (UMAP→3D seeds, forces refine); temporal scrubber
  (watch clusters emerge/dim over time).
- **"Living atlas" theme:** parchment/ink palette, serif labels, constellation
  cluster hulls, ink (manual) vs pencil (AI) edges, slow deliberate motion.
- LOD, instanced meshes, GPU picking, worker/WASM sim for 50k+ nodes.
- **Exit criteria:** 3D adds real navigational power (not a gimmick); looks
  sophisticated + historic; 2D remains the default working view.

### Phase 7 — Sync / teams (optional, weeks 27+)
- CRDT relay server, Postgres + pgvector, auth, shared spaces, presence.
- Only if you want multiplayer; single-player is fully functional without it.

---

## 3. Cross-cutting workstreams
- **Performance budget** from day one: LOD, culling, workers, virtualized lists.
- **Data portability tests:** files must round-trip through plain Markdown.
- **Privacy:** local-model path must be first-class, not an afterthought.
- **Undo/history:** global, granular, covers AI actions.
- **Testing:** unit (core/model), integration (index/graph), visual regression
  (graph render), eval harness for retrieval quality (GraphRAG).

---

## 4. Milestones / demos
| Milestone | After phase | Demo you can show |
|-----------|-------------|-------------------|
| M1 "It's mine" | 1 | Write + link notes, files on disk |
| M2 "It's structured" | 2 | Databases from blocks |
| M3 "It's a graph" | 3 | Navigate by graph, local↔global |
| M4 "It's smart" | 4 | AI suggestions, ink vs pencil |
| M5 "It answers" | 5 | GraphRAG chat with citations |
| M6 "It's beautiful" | 6 | 3D living-atlas Explore mode |

---

## 5. Recommended first move
Start **Phase 1** *plus* a **throwaway Phase-6 visual spike** in parallel:
1. Build the real local core (editor + blocks + files + search).
2. Separately, prototype the `three.js`/`3d-force-graph` "living atlas" look on
   fake data to validate the aesthetic early (cheap, high signal, de-risks the
   riskiest/most differentiating part).

Then converge: feed real graph data into the validated visual shell.

### Suggested repo layout
```
atlas/
  apps/desktop/        # Tauri app (Rust core + web UI)
  packages/core/       # block model, edges, indexing (Rust or TS)
  packages/editor/     # block/outliner editor (TS/React)
  packages/graph/      # 2D + 3D renderer (three.js)
  packages/ai/         # embeddings, suggestions, GraphRAG orchestrator
  packages/ui/         # shared design system ("living atlas" theme)
```

---

## 6. Biggest risks & mitigations
- **3D becomes a gimmick** → keep 2D default; gate 3D behind clear value tests.
- **AI erodes trust (Mem's failure)** → suggestion layer + provenance + undo.
- **Graph turns into a hairball** → LOD, clustering, focus/context, density hulls.
- **Local-first sync complexity** → CRDTs from the start; defer server to Phase 7.
- **Scope creep (cloning 4 apps)** → phase gates; each phase must be shippable.

---

*Next: I can scaffold the repo (Tauri + TS + three.js) and stand up the Phase-1
core and the Phase-6 visual spike so you can feel both ends of the product early.*
