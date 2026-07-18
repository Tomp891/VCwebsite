import { mockBlocks } from "@atlas/contracts";

/**
 * SLOT (Agent E owns final version): navigation — spaces, page tree, tags,
 * saved-query databases, recents. Placeholder lists mock pages + tags.
 */
export function NavSlot() {
  const tags = Array.from(
    new Set(mockBlocks.flatMap((b) => (b.props.tags as string[] | undefined) ?? [])),
  );
  return (
    <div>
      <h2 className="pane-title">Pages</h2>
      <ul>
        {mockBlocks.map((b) => (
          <li key={b.id}>{b.content.slice(0, 28)}…</li>
        ))}
      </ul>
      <h2 className="pane-title">Tags</h2>
      <div>{tags.map((t) => `#${t}`).join("  ")}</div>
    </div>
  );
}
