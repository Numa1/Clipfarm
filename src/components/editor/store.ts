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

  load: (tl: Timeline) => void;
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

  load: (tl) => set({ timeline: tl, past: [], future: [], selectedId: null, revision: 0 }),

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
}));
