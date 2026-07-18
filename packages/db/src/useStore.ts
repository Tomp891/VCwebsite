import { useEffect, useState } from "react";
import type { Block, EditorStore } from "@atlas/contracts";

/** Subscribe to the store and re-render on any change. */
export function useBlocks(store: EditorStore): Block[] {
  const [blocks, setBlocks] = useState<Block[]>(() => store.listBlocks());
  useEffect(() => {
    setBlocks(store.listBlocks());
    return store.subscribe(() => setBlocks(store.listBlocks()));
  }, [store]);
  return blocks;
}
