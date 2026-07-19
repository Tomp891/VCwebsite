import { useCallback, useState } from "react";
import type { Block, EditorStore } from "@atlas/contracts";
import { getOrCreateDailyNote } from "@atlas/editor";

/** How many daily notes the Journal section lists; older ones stay in Pages. */
export const JOURNAL_NAV_CAP = 14;

export interface JournalNavProps {
  store: EditorStore;
  /** Recent daily-note pages to list (already capped, most recent first). */
  notes: Block[];
  activeId?: string;
  onOpen: (blockId: string) => void;
}

/**
 * "Today" button + collapsible list of recent daily notes. Daily notes are
 * ordinary pages (title `Journal · YYYY-MM-DD`, tag `journal`); this is just a
 * nav affordance over them.
 */
export function JournalNav({ store, notes, activeId, onOpen }: JournalNavProps): JSX.Element {
  const [collapsed, setCollapsed] = useState(false);

  const openToday = useCallback(() => {
    const note = getOrCreateDailyNote(store);
    onOpen(note.id);
  }, [store, onOpen]);

  return (
    <div className="journal-nav">
      <button type="button" className="journal-today" onClick={openToday} title="Open today's daily note">
        ☼ Today
      </button>
      <div className="atlas-nav__group">
        <button
          type="button"
          className="journal-section-toggle"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
        >
          <span className="atlas-nav__glyph">{collapsed ? "▸" : "▾"}</span>
          Journal
          <span className="journal-count">{notes.length}</span>
        </button>
        {!collapsed && (
          <ul className="atlas-nav__list journal-list">
            {notes.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  className={`atlas-nav__item${activeId === n.id ? " atlas-nav__item--active" : ""}`}
                  onClick={() => onOpen(n.id)}
                >
                  <span className="atlas-nav__glyph">✎</span>
                  {typeof n.props.title === "string" ? n.props.title : n.content}
                </button>
              </li>
            ))}
            {notes.length === 0 && <li className="atlas-empty">No entries yet — press Today.</li>}
          </ul>
        )}
      </div>
    </div>
  );
}
