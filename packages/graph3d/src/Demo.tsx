import { useState } from "react";
import { mockGraphData } from "@atlas/contracts";
import { Graph3D } from "./Graph3D.js";
import "./graph3d.css";

/** Standalone harness so the 3D atlas can be eyeballed in isolation. */
export function Demo(): JSX.Element {
  const [data] = useState(() => mockGraphData());
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);

  return (
    <div className="atlas-graph3d__demo">
      <Graph3D data={data} selectedId={selectedId} onSelect={setSelectedId} />
    </div>
  );
}
