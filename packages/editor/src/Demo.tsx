import { useState } from "react";
import type { EditorStore } from "@atlas/contracts";
import { createLocalStore } from "./store.js";
import { Editor } from "./Editor.js";

export function Demo(): JSX.Element {
  // Keep the store stable across re-renders.
  const [store] = useState<EditorStore>(() => createLocalStore());
  return <Editor store={store} />;
}
