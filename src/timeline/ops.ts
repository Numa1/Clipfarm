import { current, produce } from "immer";
import { nanoid } from "nanoid";
import type { Item, Timeline, Track } from "./schema";

/** Shortest item the editor allows, in seconds. */
export const MIN_ITEM_DURATION = 0.1;

export function itemDuration(item: Item): number {
  return item.type === "video" || item.type === "audio" ? item.sourceOut - item.sourceIn : item.duration;
}

export function itemEnd(item: Item): number {
  return item.start + itemDuration(item);
}

export function timelineDuration(tl: Timeline): number {
  let end = 0;
  for (const track of tl.tracks) {
    for (const item of track.items) end = Math.max(end, itemEnd(item));
  }
  return end;
}

export function durationInFrames(tl: Timeline): number {
  return Math.max(1, Math.ceil(timelineDuration(tl) * tl.fps));
}

export function findItem(
  tl: Timeline,
  itemId: string,
): { track: Track; item: Item; index: number } | null {
  for (const track of tl.tracks) {
    const index = track.items.findIndex((i) => i.id === itemId);
    if (index !== -1) return { track, item: track.items[index], index };
  }
  return null;
}

function sortItems(track: Track) {
  track.items.sort((a, b) => a.start - b.start);
}

/** Split an item in two at timeline time `at`. Returns the timeline unchanged if `at` is outside the item. */
export function splitItem(tl: Timeline, itemId: string, at: number): Timeline {
  return produce(tl, (draft) => {
    const found = findItem(draft, itemId);
    if (!found) return;
    const { track, item, index } = found;
    const offset = at - item.start;
    if (offset < MIN_ITEM_DURATION || itemDuration(item) - offset < MIN_ITEM_DURATION) return;

    const right = structuredClone(current(item));
    right.id = nanoid(8);
    right.start = at;
    if ((item.type === "text" && right.type === "text") || (item.type === "caption" && right.type === "caption")) {
      right.duration = item.duration - offset;
      item.duration = offset;
    } else if ((item.type === "video" || item.type === "audio") && (right.type === "video" || right.type === "audio")) {
      right.sourceIn = item.sourceIn + offset;
      item.sourceOut = item.sourceIn + offset;
    }
    track.items.splice(index + 1, 0, right);
  });
}

/** Move an item's left or right edge to timeline time `to` (clamped to source bounds). */
export function trimItem(
  tl: Timeline,
  itemId: string,
  edge: "start" | "end",
  to: number,
): Timeline {
  return produce(tl, (draft) => {
    const found = findItem(draft, itemId);
    if (!found) return;
    const { item } = found;
    const end = itemEnd(item);

    if (item.type === "text" || item.type === "caption") {
      if (edge === "start") {
        const start = Math.min(Math.max(0, to), end - MIN_ITEM_DURATION);
        item.duration = end - start;
        item.start = start;
      } else {
        item.duration = Math.max(MIN_ITEM_DURATION, to - item.start);
      }
      return;
    }

    const asset = draft.assets[item.assetId];
    const maxOut = asset?.durationSec ?? Infinity;
    if (edge === "start") {
      // Can't extend before source 0 nor before timeline 0.
      const minStart = Math.max(0, item.start - item.sourceIn);
      const start = Math.min(Math.max(minStart, to), end - MIN_ITEM_DURATION);
      item.sourceIn += start - item.start;
      item.start = start;
    } else {
      const maxEnd = item.start + (maxOut - item.sourceIn);
      const newEnd = Math.max(item.start + MIN_ITEM_DURATION, Math.min(maxEnd, to));
      item.sourceOut = item.sourceIn + (newEnd - item.start);
    }
  });
}

/** Move an item to a new start (and optionally another track of the same kind). */
export function moveItem(
  tl: Timeline,
  itemId: string,
  start: number,
  toTrackId?: string,
): Timeline {
  return produce(tl, (draft) => {
    const found = findItem(draft, itemId);
    if (!found) return;
    const { track, item, index } = found;
    item.start = Math.max(0, start);
    if (toTrackId && toTrackId !== track.id) {
      const target = draft.tracks.find((t) => t.id === toTrackId);
      if (!target || target.kind !== item.type) return;
      track.items.splice(index, 1);
      target.items.push(item);
      sortItems(target);
    } else {
      sortItems(track);
    }
  });
}

export function removeItem(tl: Timeline, itemId: string): Timeline {
  return produce(tl, (draft) => {
    const found = findItem(draft, itemId);
    if (found) found.track.items.splice(found.index, 1);
  });
}

/** Add an item to a track; creates a track of the right kind if `trackId` is omitted and none exists. */
export function addItem(tl: Timeline, item: Item, trackId?: string): Timeline {
  return produce(tl, (draft) => {
    let track = trackId
      ? draft.tracks.find((t) => t.id === trackId)
      : draft.tracks.find((t) => t.kind === item.type);
    if (!track) {
      track = {
        id: nanoid(8),
        kind: item.type,
        name: item.type === "video" ? "Vidéo" : item.type === "audio" ? "Audio" : "Texte",
        muted: false,
        hidden: false,
        items: [],
      };
      draft.tracks.push(track);
    }
    if (track.kind !== item.type) return;
    track.items.push(item);
    sortItems(track);
  });
}

export function updateItem<T extends Item>(
  tl: Timeline,
  itemId: string,
  patch: Partial<Omit<T, "id" | "type">>,
): Timeline {
  return produce(tl, (draft) => {
    const found = findItem(draft, itemId);
    if (found) Object.assign(found.item, patch);
  });
}

/** Snap `t` to the nearest item edge or the playhead within `threshold` seconds. */
export function snapTime(
  tl: Timeline,
  t: number,
  threshold: number,
  opts: { ignoreItemId?: string; extra?: number[] } = {},
): number {
  const candidates = [0, ...(opts.extra ?? [])];
  for (const track of tl.tracks) {
    for (const item of track.items) {
      if (item.id === opts.ignoreItemId) continue;
      candidates.push(item.start, itemEnd(item));
    }
  }
  let best = t;
  let bestDist = threshold;
  for (const c of candidates) {
    const d = Math.abs(c - t);
    if (d < bestDist) {
      best = c;
      bestDist = d;
    }
  }
  return best;
}
