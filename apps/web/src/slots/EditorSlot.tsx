import { mockBlocks } from "@atlas/contracts";

/**
 * SLOT (Agent A owns final version): block/outliner editor with [[wikilinks]],
 * tags, block refs, backlinks. Placeholder renders mock blocks read-only.
 */
export function EditorSlot() {
  return (
    <div>
      <h2 className="pane-title">Page</h2>
      <div className="slot-placeholder">
        Editor slot — Agent A. Block editor with [[wikilinks]] + localStorage.
      </div>
      <div style={{ marginTop: 16 }}>
        {mockBlocks.map((b) => (
          <p key={b.id}>{b.content}</p>
        ))}
      </div>
    </div>
  );
}
