import { mockGraphData } from "@atlas/contracts";

/**
 * SLOT (Agents B/C/D/F own final versions): the context pane — live local graph
 * (2D default, 3D "atlas" mode), AI suggestions, and GraphRAG chat.
 * Placeholder summarizes mock graph data.
 */
export function ContextSlot() {
  const g = mockGraphData();
  return (
    <div>
      <h2 className="pane-title">Graph</h2>
      <div className="slot-placeholder">
        Graph slot — Agents B (2D) / C (3D atlas). {g.nodes.length} nodes,{" "}
        {g.links.length} edges.
      </div>
      <h2 className="pane-title" style={{ marginTop: 20 }}>
        Suggestions
      </h2>
      <div className="slot-placeholder">Agent D — AI link/tag suggestions (pencil edges).</div>
      <h2 className="pane-title" style={{ marginTop: 20 }}>
        Ask
      </h2>
      <div className="slot-placeholder">Agent F — GraphRAG chat with citations.</div>
    </div>
  );
}
