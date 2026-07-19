---
name: testing-atlas-editor
description: Test the Atlas web app (block editor, Enter behavior, graph, Ask panel) end-to-end locally. Use when verifying editor UX or apps/web UI changes.
---

# Testing the Atlas app locally

## Setup
- Repo root: monorepo (`apps/web`, `packages/*`). Run `npm install` at the root.
- Start dev server: `npm run dev` (Vite, http://localhost:5173, ready in seconds).
- No auth or secrets needed — the app is local-first (localStorage) and seeds mock pages on first load.
- Quality gates: `npm run typecheck` (tsc -b), `npm run lint` (eslint), `npm test` (vitest + node:test).

## Editor / Enter-key behavior
- The block editor lives in `packages/editor/src/Editor.tsx`; each bullet is a controlled `<textarea class="atlas-block-input">` with `rows={1}` + auto-grow.
- Expected interaction model: single Enter adds a line INSIDE the same bullet; Enter on an empty line (double-Enter) ends the bullet and creates a new focused bullet below; Backspace on an empty bullet deletes it.
- Pitfall: caret/DOM updates deferred to `requestAnimationFrame` may run before React commits a controlled-value change, making Enter look like a no-op (caret clamped, trailing newline invisible). If Enter seems visually broken, check that the keydown handler mutates `el.value`/`setSelectionRange`/height synchronously before calling the store `onChange`.
- To test: click "+ New block" in the middle Editor pane, type, press Enter, and verify the bullet grows and subsequent typing lands on the new line. Use the stripped DOM from the computer tool to confirm the textarea value contains `\n`.

## Devin Secrets Needed
- None (fully local, no external services; Ollama is optional and mock-fallback covers its absence).
