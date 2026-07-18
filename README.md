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
