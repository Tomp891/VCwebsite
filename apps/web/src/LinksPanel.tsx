import { useMemo } from "react";
import type { Block, EditorStore } from "@atlas/contracts";
import { blockTitle } from "@atlas/editor";

export interface LinksPanelProps {
  store: EditorStore;
  /** re-render key so the list tracks store mutations. */
  version: number;
  onSelect?: (id: string) => void;
}

function label(blocks: Map<string, Block>, id: string): string {
  const b = blocks.get(id);
  if (!b) return id;
  return (blockTitle(b) || b.content || id).slice(0, 28);
}

/** Inked edges (human `explicit` + AI `inferred_accepted`) with one-click undo. */
export function LinksPanel({ store, version, onSelect }: LinksPanelProps): JSX.Element {
  const { rows, byId } = useMemo(() => {
    const blocks = new Map(store.listBlocks().map((b) => [b.id, b]));
    const inked = store
      .listEdges()
      .filter((e) => e.tier === "explicit" || e.tier === "inferred_accepted");
    return { rows: inked, byId: blocks };
  }, [store, version]);

  if (rows.length === 0) {
    return <p className="atlas-empty">No inked links yet — accept a suggestion or add a [[wikilink]].</p>;
  }

  return (
    <ul className="links-panel">
      {rows.map((e) => {
        const ai = e.tier === "inferred_accepted";
        return (
          <li key={e.id} className="links-panel__row">
            <button
              className="links-panel__pair"
              type="button"
              onClick={() => onSelect?.(e.srcBlockId)}
              title={ai ? `AI-accepted (${e.provenance.method})` : "Human link"}
            >
              <span className={`links-panel__dot links-panel__dot--${ai ? "ai" : "human"}`} />
              {label(byId, e.srcBlockId)}
              <span className="links-panel__arrow">→</span>
              {label(byId, e.dstBlockId)}
            </button>
            <button
              className="links-panel__remove"
              type="button"
              title="Remove this link"
              onClick={() => store.deleteEdge(e.id)}
            >
              ×
            </button>
          </li>
        );
      })}
    </ul>
  );
}
