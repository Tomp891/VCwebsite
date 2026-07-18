/**
 * Standalone demo: an in-memory store seeded from the mock fixtures rendering the
 * SuggestionsPanel with the dependency-free mock provider. Nothing external needed.
 */

import { useMemo } from "react";
import { mockBlocks, mockEdges } from "@atlas/contracts";
import { createMockProvider } from "./provider.js";
import { createMemoryStore } from "./memStore.js";
import { SuggestionsPanel } from "./SuggestionsPanel.js";
import "./ai.css";

export function Demo(): JSX.Element {
  const store = useMemo(() => createMemoryStore(mockBlocks, mockEdges), []);
  const provider = useMemo(() => createMockProvider(), []);

  return (
    <div className="atlas-ai atlas-ai__demo">
      <header>
        <h1 className="brand" style={{ fontFamily: "var(--serif)", margin: "0 0 4px" }}>
          Atlas · AI suggestions
        </h1>
        <p className="atlas-ai__snippet" style={{ margin: "0 0 16px" }}>
          Pencil links inferred by cosine similarity — accept to ink them into the graph.
        </p>
      </header>
      <SuggestionsPanel store={store} provider={provider} />
    </div>
  );
}
