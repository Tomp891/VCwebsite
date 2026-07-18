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

## Tips / gotchas
- The graph thumbnail is small; use the computer tool's `zoom` action on the graph frame
  region to confirm 2D vs 3D rendering rather than judging from the full screenshot.
- Backlinks only count explicit `link` edges (see `packages/editor/src/Editor.tsx`), so
  verify via a real `[[wikilink]]`, not an accepted AI suggestion (those are `related`).
- Autocomplete matches page titles by prefix; type enough of the title to narrow it.
- Tests mutate localStorage (e.g. add a "Test Note" page); harmless but persists across
  runs. Clear site data if you need a clean slate.
- Server processes die on VM restart — re-run `npm run dev` before testing.
