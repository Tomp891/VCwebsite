import { NavSlot } from "./slots/NavSlot.js";
import { EditorSlot } from "./slots/EditorSlot.js";
import { ContextSlot } from "./slots/ContextSlot.js";

/**
 * App shell — three coordinated panes. Each pane renders a SLOT that a Wave-1
 * agent fills. Slots currently show placeholders backed by mock fixtures so the
 * shell runs end-to-end before real packages land.
 */
export function App() {
  return (
    <div className="app-shell">
      <aside className="pane pane-nav">
        <h1 className="brand">Atlas</h1>
        <div className="brand-sub">a cartography of thought</div>
        <NavSlot />
      </aside>
      <main className="pane pane-editor">
        <EditorSlot />
      </main>
      <aside className="pane pane-context">
        <ContextSlot />
      </aside>
    </div>
  );
}
