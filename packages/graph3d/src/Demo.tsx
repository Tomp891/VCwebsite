import { useMemo, useState } from "react";
import { mockBlocks, mockGraphData } from "@atlas/contracts";
import { Graph3D } from "./Graph3D.js";
import type { TagsById } from "./filter.js";
import type { PagePreviewContent } from "./PagePreview.js";
import "./graph3d.css";

/** Standalone harness so the 3D atlas + built-in filter panel + page preview can be eyeballed. */
export function Demo(): JSX.Element {
  const [data] = useState(() => mockGraphData());
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [openedId, setOpenedId] = useState<string | undefined>(undefined);

  // GraphNode carries no tags/content, so derive tags + preview content from the
  // source blocks (this is what integration would supply from its EditorStore).
  const { tagsById, previewById } = useMemo(() => {
    const tags: TagsById = {};
    const preview: Record<string, PagePreviewContent> = {};
    for (const b of mockBlocks) {
      const t = b.props.tags;
      if (Array.isArray(t)) tags[b.id] = t.filter((x): x is string => typeof x === "string");
      preview[b.id] = { title: b.content.split(/[.!?]/)[0], snippet: b.content };
    }
    return { tagsById: tags, previewById: preview };
  }, []);

  return (
    <div className="atlas-graph3d__demo">
      <Graph3D
        data={data}
        selectedId={selectedId}
        onSelect={setSelectedId}
        showControls
        tagsById={tagsById}
        previewById={previewById}
        onOpen={setOpenedId}
      />
      {openedId && (
        <div className="atlas-graph3d__opened" role="status">
          Opened page: <strong>{previewById[openedId]?.title ?? openedId}</strong>
          <button type="button" onClick={() => setOpenedId(undefined)}>
            ×
          </button>
        </div>
      )}
    </div>
  );
}
