import { useMemo, useState } from "react";
import { mockBlocks, type Block } from "@atlas/contracts";
import { createMemoryStore } from "./memoryStore.js";
import { NavTree } from "./NavTree.js";
import { DatabaseView } from "./DatabaseView.js";
import "./theme.css";

/** A few extra props so the database columns / board grouping have something to show. */
const STATUS = ["seedling", "growing", "evergreen"];
function enrich(blocks: Block[]): Block[] {
  return blocks.map((b, i) => ({
    ...b,
    props: {
      ...b.props,
      status: STATUS[i % STATUS.length],
      links: (b.props.tags as string[] | undefined)?.length ?? 0,
    },
  }));
}

/**
 * Standalone demo: a minimal in-memory store seeded from mockBlocks, rendered as
 * NavTree beside DatabaseView so this package can be eyeballed in isolation.
 */
export function Demo(): JSX.Element {
  const store = useMemo(() => createMemoryStore(enrich(mockBlocks)), []);
  const [opened, setOpened] = useState<string | null>(null);

  return (
    <div className="atlas-db" style={{ background: "var(--parchment)", padding: 16 }}>
      <div className="atlas-db__layout">
        <div style={{ flex: "0 0 240px" }}>
          <NavTree store={store} onOpen={setOpened} />
          {opened && (
            <p style={{ fontStyle: "italic", color: "var(--verdigris)", fontFamily: "var(--serif)" }}>
              opened → {opened}
            </p>
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <DatabaseView store={store} title="All blocks" />
        </div>
      </div>
    </div>
  );
}
