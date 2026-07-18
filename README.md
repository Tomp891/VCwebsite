# Atlas — AI graph-based knowledge management

A hybrid of Notion (structured docs/DBs), Logseq (block atomicity + bidirectional
links), Obsidian (local-first ownership) and Mem (ambient AI), unified so that
atomic blocks, a queryable knowledge graph, and AI all read/write the same
substrate.

> Built as a one-evening vertical slice using parallel agents. See `BUILD_PLAN.md`
> in the session for the full multi-phase roadmap.

## Monorepo layout

```
atlas-kms/
  packages/contracts/   # FROZEN interface contract: types, APIs, mock fixtures
  apps/web/             # Vite + React + TS app shell (3-pane workspace)
```

## Contract-first parallel build

Everything is a `Block`. Edges carry a `tier` (explicit = ink, inferred = pencil).
Every package builds against `@atlas/contracts` (types + `mock*` fixtures) so the
Wave-1 agents run fully in parallel without blocking each other.

The app shell (`apps/web/src/App.tsx`) has three panes, each rendering a **slot**
that an agent fills:

| Slot | Agent | Deliverable |
|------|-------|-------------|
| `EditorSlot` | A | block editor, `[[wikilinks]]`, localStorage, backlinks |
| `ContextSlot` → graph | B | 2D force graph (ink vs pencil edges) |
| `ContextSlot` → graph | C | 3D "living atlas" mode (layers, parchment theme) |
| `ContextSlot` → suggestions | D | embeddings + AI link/tag suggestions |
| `NavSlot` | E | properties + saved-query databases |
| `ContextSlot` → ask | F | GraphRAG chat with citations |

### Rules for parallel agents
- Build against `@atlas/contracts` + `mock*` fixtures only. Do not import another
  agent's package.
- **Do not modify `packages/contracts`** — it is frozen. Need a change? Coordinate.
- Stay in your assigned folder (file-disjoint ownership → no merge conflicts).
- Open a PR into the `integration` branch.

## Dev

```
npm install
npm run dev        # apps/web on :5173
npm run typecheck
npm run lint
```

## Local AI (Ollama)

The "Ask" box runs GraphRAG retrieval + citations locally. Answer generation
uses a pluggable `AIProvider`: by default it prefers a local **Ollama** server
and falls back to a deterministic mock when none is running (so the app works
with zero setup). No API keys, nothing paid.

To get real local answers:

```
# 1. Install Ollama: https://ollama.com/download  (must be running)
# 2. One-command setup (pulls the default models):
./scripts/setup-local-ai.sh
# 3. Run the app and open http://localhost:5173 → "Ask"
npm run dev
```

The status dot under "Ask" turns green ("Local · Ollama") automatically. Change
the server URL or models any time in **Ask → Settings** (persisted locally).

- Default chat model: `llama3.1:8b` (~4.7 GB, comfortable on 16 GB RAM). For a
  lighter/faster option use `llama3.2:3b`.
- Default embed model: `nomic-embed-text` (~275 MB).
- Run the app **locally** (not via a tunnel) so the browser can reach your
  machine's `localhost:11434`.
