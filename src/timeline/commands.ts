import { z } from "zod";
import {
  addItem,
  findItem,
  moveItem,
  removeItem,
  splitItem,
  trimItem,
  updateItem,
} from "./ops";
import { cropSchema, hookSchema, itemSchema, textStyleSchema } from "./schema";
import type { Item, TextItem, Timeline, VideoItem } from "./schema";

/**
 * Serializable commands over a timeline: a thin, JSON-safe layer on top of the pure functions in
 * `ops.ts`. Each command carries a discriminant `type` and a zod-validated payload, so it can be
 * sent over HTTP, stored in `project_revisions.ops` for audit, and replayed deterministically.
 */

export const splitCommandSchema = z.object({
  type: z.literal("split"),
  itemId: z.string().min(1),
  at: z.number().nonnegative(),
});

export const trimCommandSchema = z.object({
  type: z.literal("trim"),
  itemId: z.string().min(1),
  edge: z.enum(["start", "end"]),
  to: z.number().nonnegative(),
});

export const moveCommandSchema = z.object({
  type: z.literal("move"),
  itemId: z.string().min(1),
  start: z.number().nonnegative(),
  toTrackId: z.string().min(1).optional(),
});

export const removeCommandSchema = z.object({
  type: z.literal("remove"),
  itemId: z.string().min(1),
});

export const addCommandSchema = z.object({
  type: z.literal("add"),
  item: itemSchema,
  trackId: z.string().min(1).optional(),
});

/** Generic patch on one item (e.g. volume, text, position). Only known-safe keys ("id", "type") are protected. */
export const updateCommandSchema = z.object({
  type: z.literal("update"),
  itemId: z.string().min(1),
  patch: z.record(z.string(), z.unknown()).refine((p) => !("id" in p) && !("type" in p), {
    message: "le patch ne peut pas changer « id » ou « type »",
  }),
});

export const setCropCommandSchema = z.object({
  type: z.literal("setCrop"),
  itemId: z.string().min(1),
  crop: cropSchema,
});

export const applyStyleCommandSchema = z.object({
  type: z.literal("applyStyle"),
  itemId: z.string().min(1),
  style: textStyleSchema.partial(),
});

/** Replaces the project's suggested hooks (`meta.hooks`), e.g. after an agent regenerates them. */
export const setHookCommandSchema = z.object({
  type: z.literal("setHook"),
  hooks: z.array(hookSchema),
});

export const commandSchema = z.discriminatedUnion("type", [
  splitCommandSchema,
  trimCommandSchema,
  moveCommandSchema,
  removeCommandSchema,
  addCommandSchema,
  updateCommandSchema,
  setCropCommandSchema,
  applyStyleCommandSchema,
  setHookCommandSchema,
]);

export type Command = z.infer<typeof commandSchema>;

/** Applies one command. Unknown/no-op commands (e.g. a split outside the item) return `tl` unchanged. */
export function applyCommand(tl: Timeline, cmd: Command): Timeline {
  switch (cmd.type) {
    case "split":
      return splitItem(tl, cmd.itemId, cmd.at);
    case "trim":
      return trimItem(tl, cmd.itemId, cmd.edge, cmd.to);
    case "move":
      return moveItem(tl, cmd.itemId, cmd.start, cmd.toTrackId);
    case "remove":
      return removeItem(tl, cmd.itemId);
    case "add":
      return addItem(tl, cmd.item as Item, cmd.trackId);
    case "update":
      return updateItem(tl, cmd.itemId, cmd.patch as Partial<Omit<Item, "id" | "type">>);
    case "setCrop":
      // updateItem only assigns fields on the found item; harmless on a non-video item (crop is ignored).
      return updateItem<VideoItem>(tl, cmd.itemId, { crop: cmd.crop });
    case "applyStyle": {
      // Merge onto the item's current style: updateItem's patch is a shallow Object.assign, so an
      // unmerged partial would wipe out the style fields the caller didn't mean to touch.
      const found = findItem(tl, cmd.itemId);
      if (!found || found.item.type !== "text") return tl;
      const style = { ...found.item.style, ...cmd.style };
      return updateItem<TextItem>(tl, cmd.itemId, { style });
    }
    case "setHook":
      return setMetaHooks(tl, cmd.hooks);
  }
}

/** Applies several commands in order, threading the timeline through each. */
export function applyCommands(tl: Timeline, cmds: Command[]): Timeline {
  return cmds.reduce(applyCommand, tl);
}

/**
 * Replace `meta.hooks`. Not an item-level change, so it can't go through `updateItem`; kept local
 * to `commands.ts` (one-off, used only here) rather than added to `ops.ts`.
 */
function setMetaHooks(tl: Timeline, hooks: Timeline["meta"]["hooks"]): Timeline {
  return { ...tl, meta: { ...tl.meta, hooks } };
}
