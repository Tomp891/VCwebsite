---
name: testing-atlas-kms
description: Test the Atlas KMS web app (block editor + graph + AI suggestions + GraphRAG) end-to-end. Use when verifying UI/feature changes in this monorepo.
---

# Testing Atlas KMS

Atlas is an npm-workspaces monorepo (Vite + React + TS). The web app is `apps/web`;
features live in `packages/{editor,graph,graph3d,ai,db,rag}` built against
`@atlas/contracts` + mock fixtures. Data persists in browser `localStorage`; AI defaults
to an in-browser **mock provider** (no key needed).

## Run it
```bash
cd <repo> && npm install   # first time only
npm run dev                # serves apps/web at http://localhost:5173/
```
Verify: `npm run typecheck && npm run lint && npm run build` (all should be green).

## Devin Secrets Needed
- None. The app runs fully offline with a mock AI provider + localStorage.
- To test a *real* LLM path you'd need an Ollama server or an API key, but this is not
  wired as the default and is not required for golden-path testing.

## Golden paths to verify (UI, record + annotate)
1. **Editor ink link**: New page (Pages "+"), set title, add a block, type `[[` then a
   title → autocomplete of existing page titles appears; accept it to insert `[[Title]]`.
   Open the target page → its **Backlinks** section should list the linking note
   (was "No backlinks yet."). Proves wikilink parsing + explicit edge creation.
2. **AI pencil → ink**: Right pane "Suggestions" shows pencil rows with confidence %.
   Click "Accept · ink it" → that row disappears (count decreases; promoted to an
   `inferred_accepted` edge). Reject just dismisses.
3. **GraphRAG Ask**: Right pane "Ask" box → type a question, click Ask → answer text +
   a "Sources" list of `[block-id]` snippets renders. NOTE: with the mock provider the
   answer text is a context echo, not a real answer — that's expected; retrieval +
   citations are the real thing to check.
4. **3D Atlas**: Graph pane segmented control "2D"/"3D Atlas". Toggling to 3D renders a
   depth/perspective layered graph (atom/concept/domain), visibly different from flat 2D.
   `zoom` into the graph frame to confirm depth if the thumbnail is small.
5. **Database**: Center "Database" tab renders a table over block props (content/tags/
   title columns) with Tag/Prop/Group filters and Table/Board views.

## Golden paths added in the local-improvements work (PR #10)
6. **Unified selection**: clicking a node in the 2D graph opens that node's page in the
   center editor AND highlights the matching left-nav item. Backlink rows and GraphRAG
   path selection drive the same shared `selectedId` (see `apps/web/src/App.tsx`).
7. **Accept "ink it" animation + undo**: accepting a suggestion briefly turns the row
   solid verdigris and fades it out (~480ms), then it leaves Suggestions and a new
   `AI-accepted (cosine)` edge appears in the **Inked links** panel; its × removes the
   edge. Human links show a dark dot, AI-accepted a green dot.
8. **Deduped backlinks**: one row per source page (title + snippet), click navigates.
9. **Export / Import JSON**: nav-pane "Export" downloads `atlas-export-YYYY-MM-DD.json`
   (`{version:1, blocks, edges}`); "Import" opens a file picker and reloads with the data.
10. **Lazy 3D**: three.js is a dynamic import — 3D loads only on first "3D Atlas" click.

## Golden paths added in the tagging + graph-interface work (PR #14)
11. **Tag authoring**: on any page, an inline tag editor sits under the title
    (`TagEditor` in `packages/editor/src/Editor.tsx`). Type a tag + Enter/comma to add a
    `#tag` chip; the chip's × removes it; Backspace on empty input removes the last tag.
    Verify a new tag propagates to THREE surfaces: page chips, the left-nav **Tags** list
    (with a count), and the graph filter-chip bar. If it appears on the page but NOT in
    nav/graph, the store→derived-state wiring regressed.
12. **`#hashtag` harvest**: typing `#word` in a page title or a child block and blurring
    folds it into the page's `props.tags` (harvested on blur). Same 3-surface check.
13. **Tag filtering**: click a tag in the left nav OR the graph chip bar to filter the
    graph to matching nodes (`aria-pressed`/active styling toggles); multiple tags =
    UNION (more nodes, not fewer); a **Clear** chip resets. Nav + graph chips drive the
    same shared `activeTags` state.
14. **Node click-through preview**: clicking a graph node shows a floating **Page
    preview** card (title + snippet) with **Open page →** (and × to dismiss); Open page →
    switches the editor to that page and exits fullscreen. Works docked + fullscreen.

## Tips / gotchas
- **Best way to click a graph node reliably: open the graph Fullscreen first.** The
  "Fullscreen" button in the graph header enlarges nodes dramatically, so node clicks
  (for click-through/preview) land on the first try — far more reliable than fighting the
  small docked canvas. This also doubles as the fullscreen-preview regression check.
- **Left-nav tag buttons are the unambiguous way to toggle filters** — the graph filter
  chip bar visually overlaps the legend at the docked width, so chip clicks there can miss.
- **Store version counter**: tag/prop-only edits must refresh nav/graph. The app keys its
  memos off a monotonic mutation counter (not block/edge counts). If a removed tag leaves
  a stale graph filter chip, that counter regressed (see `version` in `App.tsx`).
- **2D node clicks are finicky** — the right-pane canvas is small and node hit radii are
  tiny. Reliable approach: hover/`scroll` up over the graph center to zoom the canvas in
  (enlarges nodes), then click. Confirm the hit via the editor title changing or the
  node-label tooltip appearing in the legend area. Budget several attempts.
- To verify **graph→page** selection, click a node whose page differs from the currently
  open one (clicking the already-open page's node only triggers focus/dim, no visible
  editor change).
- **Export/Import**: verify the download on disk (`~/Downloads/atlas-export-*.json`) and
  parse it (`python3 -c "import json; ..."`) for a robust assertion; the browser download
  bar also shows "Done". Import triggers `location.reload()`, so state resets to file.
- **Backlink cosmetic**: when a backlink's source is a root page whose content == its
  title, the row shows the same text twice (title + snippet). It's still ONE deduped row,
  not a bug — but may look duplicated in screenshots.
- The graph thumbnail is small; use the computer tool's `zoom` action on the graph frame
  region to confirm 2D vs 3D rendering rather than judging from the full screenshot.
- Backlinks only count explicit `link` edges (see `packages/editor/src/Editor.tsx`), so
  verify via a real `[[wikilink]]`, not an accepted AI suggestion (those are `related`).
- Autocomplete matches page titles by prefix; type enough of the title to narrow it.
- Tests mutate localStorage (e.g. add a "Test Note" page); harmless but persists across
  runs. Clear site data if you need a clean slate.
- Server processes die on VM restart — re-run `npm run dev` before testing.
