import { useMemo, useState } from "react";
import { mockBlocks, mockGraphData } from "@atlas/contracts";
import { Graph3D } from "./Graph3D.js";
import type { TagsById } from "./filter.js";
import "./graph3d.css";

/** Standalone harness so the 3D atlas + built-in filter panel can be eyeballed. */
export function Demo(): JSX.Element {
  const [data] = useState(() => mockGraphData());
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);

  // GraphNode carries no tags, so derive a per-node tag map from the source blocks
  // (this is what integration would supply from its EditorStore).
  const tagsById = useMemo<TagsById>(() => {
    const map: TagsById = {};
    for (const b of mockBlocks) {
      const tags = b.props.tags;
      if (Array.isArray(tags)) map[b.id] = tags.filter((t): t is string => typeof t === "string");
    }
    return map;
  }, []);

  return (
    <div className="atlas-graph3d__demo">
      <Graph3D
        data={data}
        selectedId={selectedId}
        onSelect={setSelectedId}
        showControls
        tagsById={tagsById}
      />
    </div>
  );
}
