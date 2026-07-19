/**
 * Temporal-emergence playback. Owned by subagent (d).
 *
 * `buildTimeline` derives time-ordered cluster-assignment snapshots (blocks
 * appear in creation order, accreting into their theme) so the UI can "play"
 * the graph emerging over time. `useTemporalPlayback` is a small React hook that
 * steps through those frames.
 *
 * Baseline is functional and deterministic; the subagent may enrich frames
 * (e.g. easing, per-edge reveal) without changing the signatures.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { Block, BlockId } from "@atlas/contracts";

export interface TimelineFrame {
  t: number;
  assignment: Record<BlockId, number>;
}

export interface TimelineOptions {
  /** number of snapshots to emit (evenly spaced across time). */
  frames?: number;
}

/**
 * Build cumulative assignment snapshots: at each step, blocks created up to that
 * moment are present with their (final) cluster assignment.
 */
export function buildTimeline(
  blocks: Block[],
  assignment: Record<BlockId, number>,
  opts: TimelineOptions = {},
): TimelineFrame[] {
  if (blocks.length === 0) return [];
  // stable order: creation time, with id as a deterministic tiebreak.
  const ordered = [...blocks].sort(
    (a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const steps = Math.max(1, Math.min(opts.frames ?? ordered.length, ordered.length));
  const frames: TimelineFrame[] = [];
  for (let s = 1; s <= steps; s++) {
    const upto = Math.ceil((ordered.length * s) / steps);
    const snap: Record<BlockId, number> = {};
    for (let i = 0; i < upto; i++) {
      const b = ordered[i];
      snap[b.id] = assignment[b.id] ?? 0;
    }
    frames.push({ t: ordered[upto - 1].createdAt, assignment: snap });
  }
  return frames;
}

export interface PlaybackOptions {
  /** ms between frames. */
  intervalMs?: number;
  /** loop back to the start when reaching the end. */
  loop?: boolean;
}

export interface PlaybackState {
  frameIndex: number;
  playing: boolean;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seek: (index: number) => void;
  reset: () => void;
}

/** Step through `frameCount` frames on a timer. */
export function useTemporalPlayback(
  frameCount: number,
  opts: PlaybackOptions = {},
): PlaybackState {
  const intervalMs = opts.intervalMs ?? 700;
  const loop = opts.loop ?? false;
  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  // keep the cursor in range if the timeline shrinks (e.g. data changed).
  useEffect(() => {
    setFrameIndex((i) => Math.min(i, Math.max(0, frameCount - 1)));
  }, [frameCount]);

  useEffect(() => {
    if (!playing || frameCount === 0) return;
    timer.current = setInterval(() => {
      setFrameIndex((i) => {
        if (i + 1 >= frameCount) {
          if (loop) return 0;
          setPlaying(false);
          return i;
        }
        return i + 1;
      });
    }, intervalMs);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [playing, frameCount, intervalMs, loop]);

  const play = useCallback(() => setPlaying(true), []);
  const pause = useCallback(() => setPlaying(false), []);
  const toggle = useCallback(() => setPlaying((p) => !p), []);
  const seek = useCallback(
    (index: number) => setFrameIndex(Math.max(0, Math.min(frameCount - 1, index))),
    [frameCount],
  );
  const reset = useCallback(() => {
    setPlaying(false);
    setFrameIndex(0);
  }, []);

  return { frameIndex, playing, play, pause, toggle, seek, reset };
}
