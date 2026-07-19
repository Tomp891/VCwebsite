/** localStorage keys used by the local editor store. Exported so the app can
 * implement export/import against the same keys without guessing them. */
export const STORAGE_KEYS = {
  blocks: "atlas.editor.blocks",
  edges: "atlas.editor.edges",
} as const;
