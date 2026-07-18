import { useMemo, useState } from "react";
import type { Block, EditorStore } from "@atlas/contracts";
import { useBlocks } from "./useStore.js";
import {
  EMPTY_FILTER,
  applyFilter,
  applySort,
  allTags,
  blockTags,
  formatValue,
  groupBlocks,
  propKeys,
  type Filter,
  type SortState,
} from "./query.js";
import "./theme.css";

export interface DatabaseViewProps {
  store: EditorStore;
  /** optional heading shown above the toolbar. */
  title?: string;
}

type ViewMode = "table" | "board";

/**
 * A database is a saved query over `Block.props`. Columns are the union of prop
 * keys across the blocks; supports filtering (tag / prop value / text), sorting,
 * grouping, and a kanban board toggle grouping by a chosen prop.
 */
export function DatabaseView({ store, title = "Database" }: DatabaseViewProps): JSX.Element {
  const blocks = useBlocks(store);
  const [filter, setFilter] = useState<Filter>(EMPTY_FILTER);
  const [sort, setSort] = useState<SortState | null>(null);
  const [groupKey, setGroupKey] = useState<string>("");
  const [mode, setMode] = useState<ViewMode>("table");
  const [boardKey, setBoardKey] = useState<string>("tags");

  const keys = useMemo(() => propKeys(blocks), [blocks]);
  const tags = useMemo(() => allTags(blocks), [blocks]);
  const columns = useMemo(() => ["content", ...keys], [keys]);

  const rows = useMemo(
    () => applySort(applyFilter(blocks, filter), sort),
    [blocks, filter, sort],
  );

  const patch = (p: Partial<Filter>) => setFilter((f) => ({ ...f, ...p }));

  function toggleSort(key: string) {
    setSort((s) => {
      if (!s || s.key !== key) return { key, dir: "asc" };
      if (s.dir === "asc") return { key, dir: "desc" };
      return null;
    });
  }

  const groups = useMemo(
    () => groupBlocks(rows, mode === "board" ? boardKey : groupKey),
    [rows, mode, boardKey, groupKey],
  );

  return (
    <section className="atlas-db atlas-dbview">
      <h3 className="atlas-db__section-title">{title}</h3>

      <div className="atlas-dbview__toolbar">
        <input
          type="text"
          placeholder="Search content…"
          value={filter.text}
          onChange={(e) => patch({ text: e.target.value })}
          aria-label="Search content"
        />

        <label>
          Tag
          <select value={filter.tag} onChange={(e) => patch({ tag: e.target.value })}>
            <option value="">all</option>
            {tags.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>

        <label>
          Prop
          <select value={filter.propKey} onChange={(e) => patch({ propKey: e.target.value, propValue: "" })}>
            <option value="">—</option>
            {keys.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
        {filter.propKey && (
          <input
            type="text"
            placeholder={`${filter.propKey} contains…`}
            value={filter.propValue}
            onChange={(e) => patch({ propValue: e.target.value })}
            aria-label="Prop value filter"
          />
        )}

        {mode === "table" ? (
          <label>
            Group
            <select value={groupKey} onChange={(e) => setGroupKey(e.target.value)}>
              <option value="">none</option>
              {columns
                .filter((c) => c !== "content")
                .map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
            </select>
          </label>
        ) : (
          <label>
            Column by
            <select value={boardKey} onChange={(e) => setBoardKey(e.target.value)}>
              {keys.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="atlas-dbview__seg" role="group" aria-label="View mode">
          <button aria-pressed={mode === "table"} onClick={() => setMode("table")}>
            Table
          </button>
          <button aria-pressed={mode === "board"} onClick={() => setMode("board")}>
            Board
          </button>
        </div>

        <span className="atlas-dbview__count">{rows.length} blocks</span>
      </div>

      {rows.length === 0 ? (
        <div className="atlas-empty">No blocks match this query.</div>
      ) : mode === "table" ? (
        <TableView columns={columns} groups={groups} sort={sort} onSort={toggleSort} grouped={!!groupKey} />
      ) : (
        <BoardView groups={groups} />
      )}
    </section>
  );
}

interface TableViewProps {
  columns: string[];
  groups: { key: string; blocks: Block[] }[];
  sort: SortState | null;
  onSort: (key: string) => void;
  grouped: boolean;
}

function sortGlyph(sort: SortState | null, key: string): string {
  if (!sort || sort.key !== key) return "";
  return sort.dir === "asc" ? "▲" : "▼";
}

function TableView({ columns, groups, sort, onSort, grouped }: TableViewProps): JSX.Element {
  return (
    <table className="atlas-table">
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={c} onClick={() => onSort(c)}>
              {c}
              <span className="atlas-table__sort">{sortGlyph(sort, c)}</span>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {groups.map((g) => (
          <GroupRows key={g.key || "__all"} group={g} columns={columns} grouped={grouped} />
        ))}
      </tbody>
    </table>
  );
}

function GroupRows({
  group,
  columns,
  grouped,
}: {
  group: { key: string; blocks: Block[] };
  columns: string[];
  grouped: boolean;
}): JSX.Element {
  return (
    <>
      {grouped && (
        <tr className="atlas-table__group-row">
          <td colSpan={columns.length}>
            {group.key} · {group.blocks.length}
          </td>
        </tr>
      )}
      {group.blocks.map((b) => (
        <tr key={b.id}>
          {columns.map((c) => (
            <td key={c} className={c === "content" ? "atlas-table__content" : undefined}>
              <Cell block={b} column={c} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

function Cell({ block, column }: { block: Block; column: string }): JSX.Element {
  if (column === "content") return <span>{block.content}</span>;
  const value = block.props[column];
  if (Array.isArray(value)) {
    return (
      <>
        {value.map((v) => (
          <span key={v} className="atlas-chip">
            {v}
          </span>
        ))}
      </>
    );
  }
  return <span>{formatValue(value)}</span>;
}

function BoardView({ groups }: { groups: { key: string; blocks: Block[] }[] }): JSX.Element {
  return (
    <div className="atlas-board">
      {groups.map((g) => (
        <div key={g.key || "__all"} className="atlas-board__col">
          <h4 className="atlas-board__col-title">
            <span>{g.key || "—"}</span>
            <span>{g.blocks.length}</span>
          </h4>
          {g.blocks.map((b) => (
            <div key={b.id} className="atlas-card">
              <div className="atlas-card__content">{b.content}</div>
              {blockTags(b).map((t) => (
                <span key={t} className="atlas-chip">
                  {t}
                </span>
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
