"use client";

import type { PlayerRef } from "@remotion/player";
import { Filmstrip, MagnifierMinus, MagnifierPlus, MusicNote, Scissors, Text, VolumeFill, VolumeSlashFill } from "@gravity-ui/icons";
import { Button, Chip, Kbd, Separator } from "@heroui/react";
import { useRef, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { produce } from "immer";
import { formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { itemDuration, moveItem, snapTime, timelineDuration, trimItem } from "@/timeline/ops";
import type { Item, Track } from "@/timeline/schema";
import { IconAction } from "./icon-action";
import { useEditor } from "./store";

const LABEL_W = 120;
const TRACK_H = 52;
const SNAP_PX = 8;

const TRACK_ICON = { video: Filmstrip, text: Text, audio: MusicNote } as const;
const ITEM_COLOR = {
  video: "bg-track-video/20 border-track-video/50",
  text: "bg-track-text/20 border-track-text/50",
  audio: "bg-track-audio/20 border-track-audio/50",
} as const;

export function TimelineView({ playerRef, onSplit }: { playerRef: RefObject<PlayerRef | null>; onSplit: () => void }) {
  const timeline = useEditor((s) => s.timeline)!;
  const pxPerSec = useEditor((s) => s.pxPerSec);
  const playhead = useEditor((s) => s.playhead);
  const setZoom = useEditor((s) => s.setZoom);
  const scrollRef = useRef<HTMLDivElement>(null);

  const total = timelineDuration(timeline);
  // Leave room after the last item to drag things further.
  const width = Math.max(total + 10, 30) * pxPerSec;

  const seek = (sec: number) => {
    const frame = Math.round(Math.max(0, Math.min(sec, total)) * timeline.fps);
    playerRef.current?.seekTo(frame);
    useEditor.getState().setPlayhead(frame / timeline.fps);
  };

  const onRulerPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const toSec = (clientX: number) => (clientX - rect.left) / pxPerSec;
    playerRef.current?.pause();
    seek(toSec(e.clientX));
    const move = (ev: PointerEvent) => seek(toSec(ev.clientX));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const tickStep = pxPerSec >= 80 ? 1 : pxPerSec >= 30 ? 2 : pxPerSec >= 12 ? 5 : 10;
  const ticks = Array.from({ length: Math.ceil(width / pxPerSec / tickStep) + 1 }, (_, i) => i * tickStep);

  return (
    <div className="flex h-64 shrink-0 flex-col border-t border-border bg-surface">
      <div className="flex h-11 items-center gap-3 border-b border-separator px-3">
        <Button variant="ghost" size="sm" onPress={onSplit}>
          <Scissors />
          Couper
          <Kbd variant="light">
            <Kbd.Content>S</Kbd.Content>
          </Kbd>
        </Button>
        <Separator orientation="vertical" className="h-5" />
        <span className="font-mono text-xs text-muted tabular-nums">
          <span className="text-foreground">{formatTime(playhead)}</span> / {formatTime(total)}
        </span>
        {(total > 60 || total < 30) && (
          <Chip size="sm" variant="soft" color={total > 60 ? "warning" : "default"}>
            <Chip.Label>{total > 60 ? "Plus de 60 s" : "Moins de 30 s"}</Chip.Label>
          </Chip>
        )}
        <div className="ml-auto flex items-center gap-1">
          <IconAction label="Dézoomer" onPress={() => setZoom(pxPerSec / 1.4)}>
            <MagnifierMinus />
          </IconAction>
          <IconAction label="Zoomer" shortcut="⌘ molette" onPress={() => setZoom(pxPerSec * 1.4)}>
            <MagnifierPlus />
          </IconAction>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="shrink-0 border-r border-separator" style={{ width: LABEL_W }}>
          <div className="h-6 border-b border-separator" />
          {timeline.tracks.map((t) => (
            <TrackLabel key={t.id} track={t} />
          ))}
        </div>

        <div
          ref={scrollRef}
          className="relative min-w-0 flex-1 overflow-x-auto overflow-y-hidden"
          onWheel={(e) => {
            if (e.ctrlKey || e.metaKey) {
              e.preventDefault();
              setZoom(pxPerSec * (e.deltaY < 0 ? 1.1 : 0.9));
            }
          }}
        >
          <div className="relative" style={{ width }}>
            <div className="relative h-6 cursor-ew-resize border-b border-separator select-none" onPointerDown={onRulerPointerDown}>
              {ticks.map((t) => (
                <div key={t} className="absolute top-0 h-full border-l border-separator" style={{ left: t * pxPerSec }}>
                  <span className="ml-1 font-mono text-[10px] text-muted tabular-nums">{formatTime(t, 0)}</span>
                </div>
              ))}
            </div>

            {timeline.tracks.map((track) => (
              <div
                key={track.id}
                data-track-id={track.id}
                data-track-kind={track.kind}
                className="relative border-b border-separator"
                style={{ height: TRACK_H }}
                onPointerDown={(e) => e.target === e.currentTarget && useEditor.getState().select(null)}
              >
                {track.items.map((item) => (
                  <TimelineItem key={item.id} item={item} trackId={track.id} />
                ))}
              </div>
            ))}

            <div
              className="pointer-events-none absolute top-0 bottom-0 w-px bg-danger"
              style={{ left: playhead * pxPerSec }}
            >
              <div className="-ml-1 size-2 rotate-45 bg-danger" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TrackLabel({ track }: { track: Track }) {
  const apply = useEditor((s) => s.apply);
  const Icon = TRACK_ICON[track.kind];
  return (
    <div className="flex items-center gap-2 border-b border-separator ps-3 pe-1.5 text-xs" style={{ height: TRACK_H }}>
      <Icon className="size-3.5 shrink-0 text-muted" />
      <span className="min-w-0 flex-1 truncate">{track.name}</span>
      {track.kind !== "text" && (
        <IconAction
          label={track.muted ? "Réactiver le son" : "Couper le son"}
          onPress={() =>
            apply((tl) =>
              produce(tl, (d) => {
                const t = d.tracks.find((x) => x.id === track.id);
                if (t) t.muted = !t.muted;
              }),
            )
          }
        >
          {track.muted ? <VolumeSlashFill className="text-danger" /> : <VolumeFill className="text-muted" />}
        </IconAction>
      )}
    </div>
  );
}

function itemLabel(item: Item, assets: Record<string, { src: string }>): string {
  if (item.type === "text") return item.text || "Texte";
  const src = assets[item.assetId]?.src ?? "";
  return item.type === "audio" ? (src.split("/").pop() ?? "Audio") : `${formatTime(item.sourceIn, 0)} → ${formatTime(item.sourceOut, 0)}`;
}

function TimelineItem({ item, trackId }: { item: Item; trackId: string }) {
  const pxPerSec = useEditor((s) => s.pxPerSec);
  const selected = useEditor((s) => s.selectedId === item.id);
  const assets = useEditor((s) => s.timeline!.assets);

  /** Shared drag logic for move / trim, with snapping to other edges and the playhead. */
  const startDrag = (e: ReactPointerEvent, mode: "move" | "start" | "end") => {
    e.stopPropagation();
    e.preventDefault();
    const st = useEditor.getState();
    st.select(item.id);
    st.beginGesture();
    const x0 = e.clientX;
    const origStart = item.start;
    const origEnd = item.start + itemDuration(item);
    const len = origEnd - origStart;

    const move = (ev: PointerEvent) => {
      const { pxPerSec: pps, playhead, timeline } = useEditor.getState();
      const dt = (ev.clientX - x0) / pps;
      const snap = (t: number) => snapTime(timeline!, t, SNAP_PX / pps, { ignoreItemId: item.id, extra: [playhead] });

      if (mode === "move") {
        // Snap whichever edge is closer to a target.
        let start = Math.max(0, origStart + dt);
        const s1 = snap(start);
        const s2 = snap(start + len) - len;
        start = Math.abs(s1 - start) <= Math.abs(s2 - start) ? s1 : s2;
        const over = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>("[data-track-id]");
        const toTrack = over?.dataset.trackKind === item.type ? over.dataset.trackId : trackId;
        st.preview((base) => moveItem(base, item.id, start, toTrack));
      } else {
        const edgeT = snap((mode === "start" ? origStart : origEnd) + dt);
        st.preview((base) => trimItem(base, item.id, mode, edgeT));
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      useEditor.getState().endGesture();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const left = item.start * pxPerSec;
  const w = Math.max(4, itemDuration(item) * pxPerSec);

  return (
    <div
      className={cn(
        "group absolute top-1.5 bottom-1.5 flex cursor-grab items-center overflow-hidden rounded-md border text-[11px] select-none active:cursor-grabbing",
        ITEM_COLOR[item.type],
        selected && "ring-2 ring-foreground",
      )}
      style={{ left, width: w }}
      onPointerDown={(e) => startDrag(e, "move")}
    >
      <div
        className="absolute inset-y-0 left-0 w-2 cursor-ew-resize group-hover:bg-foreground/20"
        onPointerDown={(e) => startDrag(e, "start")}
      />
      <span className="truncate px-2.5">{itemLabel(item, assets)}</span>
      <div
        className="absolute inset-y-0 right-0 w-2 cursor-ew-resize group-hover:bg-foreground/20"
        onPointerDown={(e) => startDrag(e, "end")}
      />
    </div>
  );
}
