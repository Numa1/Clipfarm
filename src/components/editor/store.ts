"use client";

import { create } from "zustand";
import type { Timeline } from "@/timeline/schema";

const HISTORY_LIMIT = 200;

type EditorState = {
  timeline: Timeline | null;
  past: Timeline[];
  future: Timeline[];
  selectedId: string | null;
  /** Playhead in seconds (mirrors the Remotion player). */
  playhead: number;
  /** Timeline zoom, pixels per second. */
  pxPerSec: number;
  /** Bumped on every user edit; drives autosave. */
  revision: number;
  /** Id of the automatic reframe job running in the worker (autosave pauses meanwhile). */
  reframeJobId: string | null;
  /**
   * Server-side `projects.revision` the current `timeline` was built on top of (the `baseRevision`
   * the next save should send). Set on load and after every accepted save; see `resyncAfterConflict`.
   */
  baseRevision: number;
  /** True right after a save came back 409 (base out of date): local edits are kept, not retried yet. */
  saveConflict: boolean;

  load: (tl: Timeline, baseRevision?: number) => void;
  /** Apply an edit (pure op) and record it in history. */
  apply: (op: (tl: Timeline) => Timeline) => void;
  /** Update without history (e.g. merging background reframe results). */
  replaceSilently: (op: (tl: Timeline) => Timeline) => void;
  /** Start a continuous gesture (drag): snapshot once, then `preview` freely, history gets a single entry. */
  beginGesture: () => void;
  preview: (op: (base: Timeline) => Timeline) => void;
  endGesture: () => void;
  undo: () => void;
  redo: () => void;
  select: (id: string | null) => void;
  setPlayhead: (t: number) => void;
  setZoom: (pxPerSec: number) => void;
  setReframeJob: (id: string | null) => void;
  /** Accept a server save (revision it was recorded at): clears the conflict flag and bumps `baseRevision`. */
  acceptSave: (revision: number) => void;
  /** Flag a save as refused (409): the UI can show it; local edits are left untouched. */
  markSaveConflict: () => void;
  /**
   * Recalage after a 409: the caller refetches the project and passes its current server revision.
   * Local edits are never discarded here — only `baseRevision` moves, so the next autosave retries
   * on top of the fresh revision instead of failing again with the same stale base.
   */
  resyncAfterConflict: (baseRevision: number) => void;
};

let gestureBase: Timeline | null = null;

export const useEditor = create<EditorState>((set, get) => ({
  timeline: null,
  past: [],
  future: [],
  selectedId: null,
  playhead: 0,
  pxPerSec: 40,
  revision: 0,
  reframeJobId: null,
  baseRevision: 0,
  saveConflict: false,

  load: (tl, baseRevision = 0) =>
    set({ timeline: tl, past: [], future: [], selectedId: null, revision: 0, baseRevision, saveConflict: false }),

  apply: (op) => {
    const { timeline, past, revision } = get();
    if (!timeline) return;
    const next = op(timeline);
    if (next === timeline) return;
    set({ timeline: next, past: [...past, timeline].slice(-HISTORY_LIMIT), future: [], revision: revision + 1 });
  },

  replaceSilently: (op) => {
    const { timeline } = get();
    if (timeline) set({ timeline: op(timeline) });
  },

  beginGesture: () => {
    gestureBase ??= get().timeline;
  },
  preview: (op) => {
    if (gestureBase) set({ timeline: op(gestureBase) });
  },
  endGesture: () => {
    const { timeline, past, revision } = get();
    if (gestureBase && timeline && timeline !== gestureBase) {
      set({ past: [...past, gestureBase].slice(-HISTORY_LIMIT), future: [], revision: revision + 1 });
    }
    gestureBase = null;
  },

  undo: () => {
    const { timeline, past, future, revision } = get();
    const prev = past.at(-1);
    if (!timeline || !prev) return;
    set({ timeline: prev, past: past.slice(0, -1), future: [timeline, ...future], revision: revision + 1 });
  },
  redo: () => {
    const { timeline, past, future, revision } = get();
    const next = future[0];
    if (!timeline || !next) return;
    set({ timeline: next, past: [...past, timeline], future: future.slice(1), revision: revision + 1 });
  },

  select: (id) => set({ selectedId: id }),
  setPlayhead: (t) => set({ playhead: Math.max(0, t) }),
  setZoom: (pxPerSec) => set({ pxPerSec: Math.min(400, Math.max(5, pxPerSec)) }),
  setReframeJob: (id) => set({ reframeJobId: id }),

  acceptSave: (revision) => set({ baseRevision: revision, saveConflict: false }),

  markSaveConflict: () => set({ saveConflict: true }),

  resyncAfterConflict: (baseRevision) => set({ baseRevision, saveConflict: false }),
}));
