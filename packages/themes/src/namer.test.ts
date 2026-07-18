import { describe, it, expect } from "vitest";
import { mockBlocks } from "@atlas/contracts";
import type { BlockId, Cluster } from "@atlas/contracts";

import { LocalThemeNamer, createThemeNamer } from "./namer.js";

function cluster(blockIds: BlockId[]): Cluster {
  return { id: 7, blockIds, cohesion: 0.7 };
}

describe("LocalThemeNamer / createThemeNamer", () => {
  const c = cluster(["n1", "n3", "n5", "n7"]);

  it("produces a Theme matching the frozen contract", async () => {
    const namer = createThemeNamer();
    const theme = await namer.name(c, mockBlocks);

    expect(theme.clusterId).toBe(7);
    expect(typeof theme.label).toBe("string");
    expect(theme.label.length).toBeGreaterThan(0);
    expect(Array.isArray(theme.keyphrases)).toBe(true);
    expect(theme.blockIds).toEqual(["n1", "n3", "n5", "n7"]);
    expect(Array.isArray(theme.exemplars)).toBe(true);
    expect(theme.confidence).toBeGreaterThanOrEqual(0);
    expect(theme.confidence).toBeLessThanOrEqual(1);
    expect(theme.method).toBe("keyphrase");
    expect(theme.status).toBe("ambient");
  });

  it("copies blockIds rather than aliasing the cluster", async () => {
    const theme = await createThemeNamer().name(c, mockBlocks);
    expect(theme.blockIds).not.toBe(c.blockIds);
  });

  it("is deterministic across two runs", async () => {
    const namer = new LocalThemeNamer();
    const first = await namer.name(c, mockBlocks);
    const second = await namer.name(c, mockBlocks);
    expect(first).toEqual(second);
  });

  it("honours option limits for keyphrases and exemplars", async () => {
    const namer = createThemeNamer({ keyphraseLimit: 2, exemplarLimit: 1 });
    const theme = await namer.name(c, mockBlocks);
    expect(theme.keyphrases.length).toBeLessThanOrEqual(2);
    expect(theme.exemplars.length).toBeLessThanOrEqual(1);
  });
});
