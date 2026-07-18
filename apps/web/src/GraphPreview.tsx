import { useMemo } from "react";
import type { EditorStore } from "@atlas/contracts";
import { blockTitle } from "@atlas/editor";

export interface GraphPreviewProps {
  store: EditorStore;
  /** The page block to preview (already resolved by walking parentId). */
  pageId: string;
  /** Bumped on store change so the snippet re-derives. */
  version: number;
  /** Open the page in the editor. */
  onOpen: () => void;
  /** Dismiss the preview. */
  onClose: () => void;
}

/** Up to `max` chars of the page's own text plus its child blocks. */
function pageSnippet(store: EditorStore, pageId: string, max = 220): string {
  const page = store.getBlock(pageId);
  if (!page) return "";
  const children = store
    .listBlocks()
    .filter((b) => b.parentId === pageId)
    .sort((a, b) => a.order - b.order)
    .map((b) => b.content.trim())
    .filter(Boolean);
  const title = blockTitle(page);
  // Drop the leading line if it just repeats the title.
  const body = [page.content.trim(), ...children]
    .filter((t) => t && t !== title)
    .join(" · ");
  const text = body || title;
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

/** A floating card previewing the selected node's page, with click-through. */
export function GraphPreview({
  store,
  pageId,
  version,
  onOpen,
  onClose,
}: GraphPreviewProps): JSX.Element | null {
  const page = store.getBlock(pageId);
  const title = page ? blockTitle(page) : "";
  const snippet = useMemo(
    () => pageSnippet(store, pageId),
    [store, pageId, version],
  );

  if (!page) return null;

  return (
    <div className="graph-preview" role="dialog" aria-label="Page preview">
      <button
        className="graph-preview__close"
        onClick={onClose}
        title="Dismiss preview"
        aria-label="Dismiss preview"
      >
        ×
      </button>
      <h3 className="graph-preview__title">{title}</h3>
      {snippet && snippet !== title && (
        <p className="graph-preview__snippet">{snippet}</p>
      )}
      <button className="graph-preview__open" onClick={onOpen}>
        Open page →
      </button>
    </div>
  );
}
