import { useMemo, useState } from "react";
import { mockGraphData } from "@atlas/contracts";

import { Graph2D } from "./Graph2D.js";

/** Standalone harness so Graph2D can be eyeballed against the mock fixtures. */
export function Demo(): JSX.Element {
  const data = useMemo(() => mockGraphData(), []);
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);

  return (
    <div style={{ width: "100%", height: "100%", minHeight: 480 }}>
      <Graph2D
        data={data}
        selectedId={selectedId}
        onSelect={(id) =>
          setSelectedId((prev) => (prev === id ? undefined : id))
        }
      />
    </div>
  );
}
