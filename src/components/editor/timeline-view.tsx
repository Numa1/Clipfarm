"use client";

import type { PlayerRef } from "@remotion/player";
import {
  CircleCheck,
  CircleInfo,
  Filmstrip,
  MagnifierMinus,
  MagnifierPlus,
  MusicNote,
  Scissors,
  Text,
  TriangleExclamation,
  VolumeFill,
  VolumeSlashFill,
} from "@gravity-ui/icons";
import { Button, Chip, Kbd, Separator } from "@heroui/react";
import { useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { produce } from "immer";
import { formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { itemDuration, moveItem, snapTime, timelineDuration, trimItem } from "@/timeline/ops";
import type { Item, Track } from "@/timeline/schema";
import { IconAction } from "./icon-action";
import { useEditor } from "./store";
import { TimelineRuler } from "./timeline-ruler";

const LABEL_W = 120;
const TRACK_H = 52;
const SNAP_PX = 8;
const RULER_H = 24;
const DEFAULT_PX_PER_SEC = 40;

const TRACK_ICON = { video: Filmstrip, text: Text, audio: MusicNote } as const;
const ITEM_COLOR = {
  video: "bg-track-video/15 border-track-video/40 hover:bg-track-video/25 hover:border-track-video/60",
  text: "bg-track-text/15 border-track-text/40 hover:bg-track-text/25 hover:border-track-text/60",
  audio: "bg-track-audio/15 border-track-audio/40 hover:bg-track-audio/25 hover:border-track-audio/60",
} as const;
const ITEM_SELECTED = {
  video: "bg-track-video/30 border-track-video ring-1 ring-track-video shadow-[0_0_16px_-4px_var(--color-track-video)]",
  text: "bg-track-text/30 border-track-text ring-1 ring-track-text shadow-[0_0_16px_-4px_var(--color-track-text)]",
  audio: "bg-track-audio/30 border-track-audio ring-1 ring-track-audio shadow-[0_0_16px_-4px_var(--color-track-audio)]",
} as const;
const TRACK_TEXT = { video: "text-track-video", text: "text-track-text", audio: "text-track-audio" } as const;
const TRACK_DOT = { video: "bg-track-video/15", text: "bg-track-text/15", audio: "bg-track-audio/15" } as const;

const DURATION_STATE = {
  over: { color: "warning", Icon: TriangleExclamation, label: "Plus de 60 s" },
  under: { color: "default", Icon: CircleInfo, label: "Moins de 30 s" },
  ok: { color: "success", Icon: CircleCheck, label: "Durée idéale" },
} as const;

function DurationChip({ total }: { total: number }) {
  const state = total > 60 ? "over" : total < 30 ? "under" : "ok";
  const { color, Icon, label } = DURATION_STATE[state];
  return (
    <Chip key={state} size="sm" variant="soft" color={color} className="animate-fade-in">
      <Icon className="size-3" />
      <Chip.Label>{label}</Chip.Label>
    </Chip>
  );
}

/** Current time label: the only part of the toolbar that follows playback frame by frame. */
function PlayheadTime({ className }: { className?: string }) {
  const playhead = useEditor((s) => s.playhead);
  return <span className={className}>{formatTime(playhead)}</span>;
}

/**
 * Playhead line. Isolated so that playback (30 updates a second) re-renders this line only, not the
 * whole timeline with its items.
 */
function PlayheadLine({ pxPerSec, scrubbing }: { pxPerSec: number; scrubbing: boolean }) {
  const playhead = useEditor((s) => s.playhead);
  return (
    <div
      className="pointer-events-none absolute top-0 bottom-0 z-20 w-px bg-danger"
      style={{ left: playhead * pxPerSec }}
    >
      <div className="absolute top-0 left-1/2 h-3.5 w-2.5 -translate-x-1/2 rounded-t-[3px] rounded-b-full bg-danger shadow-sm" />
      <span
        className={cn(
          "absolute top-[3px] left-2 rounded-sm bg-danger px-1 py-px font-mono text-[10px] leading-none whitespace-nowrap text-danger-foreground tabular-nums transition-[opacity,translate] duration-150 ease-snappy",
          scrubbing ? "translate-x-0 opacity-100" : "-translate-x-1 opacity-0",
        )}
      >
        {formatTime(playhead)}
      </span>
    </div>
  );
}

export function TimelineView({ playerRef, onSplit }: { playerRef: RefObject<PlayerRef | null>; onSplit: () => void }) {
  const timeline = useEditor((s) => s.timeline)!;
  const pxPerSec = useEditor((s) => s.pxPerSec);
  const setZoom = useEditor((s) => s.setZoom);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrubbing, setScrubbing] = useState(false);

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
          <PlayheadTime className="font-medium text-foreground" />
          <span className="mx-1 text-muted/60">/</span>
          {formatTime(total)}
        </span>
        <DurationChip total={total} />
        <div className="ml-auto flex items-center gap-0.5">
          <IconAction label="Dézoomer" onPress={() => setZoom(pxPerSec / 1.4)}>
            <MagnifierMinus />
          </IconAction>
          <span className="w-10 text-center font-mono text-[11px] text-muted tabular-nums" aria-label="Niveau de zoom">
            {Math.round((pxPerSec / DEFAULT_PX_PER_SEC) * 100)} %
          </span>
          <IconAction label="Zoomer" shortcut="⌘ molette" onPress={() => setZoom(pxPerSec * 1.4)}>
            <MagnifierPlus />
          </IconAction>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="shrink-0 border-r border-separator" style={{ width: LABEL_W }}>
          <div className="border-b border-separator" style={{ height: RULER_H }} />
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
          <div className="relative" style={{ width }} data-timeline-content>
            <TimelineRuler
              width={width}
              pxPerSec={pxPerSec}
              contentHeight={RULER_H + timeline.tracks.length * TRACK_H}
              onPointerDown={onRulerPointerDown}
              onScrubChange={setScrubbing}
            />

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
                  <TimelineItem key={item.id} item={item} trackId={track.id} muted={track.muted} />
                ))}
              </div>
            ))}

            <div
              data-snap-guide
              className="pointer-events-none absolute bottom-0 z-10 w-px bg-foreground/70 opacity-0 transition-opacity duration-150 ease-smooth data-[active=true]:opacity-100"
              style={{ top: RULER_H }}
            />

            <PlayheadLine pxPerSec={pxPerSec} scrubbing={scrubbing} />
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
    <div className="flex items-center gap-2 border-b border-separator ps-2.5 pe-1.5 text-xs" style={{ height: TRACK_H }}>
      <span className={cn("grid size-5 shrink-0 place-items-center rounded-md", TRACK_DOT[track.kind])}>
        <Icon className={cn("size-3", TRACK_TEXT[track.kind])} />
      </span>
      <span
        className={cn(
          "min-w-0 flex-1 truncate transition-colors duration-150 ease-smooth",
          track.muted ? "text-muted" : "text-foreground",
        )}
      >
        {track.name}
      </span>
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
          <span className="grid size-4 place-items-center *:col-start-1 *:row-start-1 *:transition-[opacity,scale] *:duration-200 *:ease-snappy">
            <VolumeFill className={cn("text-muted", track.muted ? "scale-75 opacity-0" : "scale-100 opacity-100")} />
            <VolumeSlashFill className={cn("text-danger", track.muted ? "scale-100 opacity-100" : "scale-75 opacity-0")} />
          </span>
        </IconAction>
      )}
    </div>
  );
}

function ItemLabel({ item, assets }: { item: Item; assets: Record<string, { src: string }> }) {
  const Icon = TRACK_ICON[item.type];
  return (
    <span className="flex min-w-0 items-center gap-1.5 px-2.5">
      <Icon className={cn("size-3 shrink-0", TRACK_TEXT[item.type])} />
      {item.type === "video" ? (
        <span className="truncate font-mono text-[10px] text-foreground/80 tabular-nums">
          {formatTime(item.sourceIn)}
          <span className="mx-1 text-muted">→</span>
          {formatTime(item.sourceOut)}
        </span>
      ) : (
        <span className="truncate font-medium text-foreground/90">
          {item.type === "text" ? item.text || "Texte" : (assets[item.assetId]?.src.split("/").pop() ?? "Audio")}
        </span>
      )}
    </span>
  );
}

function TrimHandle({ side, onPointerDown }: { side: "start" | "end"; onPointerDown: (e: ReactPointerEvent) => void }) {
  return (
    <div
      className={cn(
        "group/handle absolute inset-y-0 z-10 flex w-2.5 cursor-col-resize items-center justify-center",
        side === "start" ? "left-0" : "right-0",
      )}
      onPointerDown={onPointerDown}
    >
      <span className="h-4 w-[3px] rounded-full bg-foreground/80 opacity-0 shadow-sm transition-[opacity,scale] duration-150 ease-smooth group-hover:opacity-70 group-data-[selected=true]:opacity-60 group-hover/handle:scale-y-125 group-hover/handle:opacity-100" />
    </div>
  );
}

function TimelineItem({ item, trackId, muted }: { item: Item; trackId: string; muted: boolean }) {
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
    const guide = (e.currentTarget as HTMLElement)
      .closest("[data-timeline-content]")
      ?.querySelector<HTMLElement>("[data-snap-guide]");
    const showGuide = (t: number | null, pps: number) => {
      if (!guide) return;
      if (t !== null) guide.style.left = `${t * pps}px`;
      guide.dataset.active = String(t !== null);
    };
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
        const e2 = snap(start + len);
        const s2 = e2 - len;
        const useStart = Math.abs(s1 - start) <= Math.abs(s2 - start);
        showGuide(useStart ? (s1 !== start ? s1 : null) : e2 !== start + len ? e2 : null, pps);
        start = useStart ? s1 : s2;
        const over = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>("[data-track-id]");
        const toTrack = over?.dataset.trackKind === item.type ? over.dataset.trackId : trackId;
        st.preview((base) => moveItem(base, item.id, start, toTrack));
      } else {
        const rawEdge = (mode === "start" ? origStart : origEnd) + dt;
        const edgeT = snap(rawEdge);
        showGuide(edgeT !== rawEdge ? edgeT : null, pps);
        st.preview((base) => trimItem(base, item.id, mode, edgeT));
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      showGuide(null, 0);
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
        "transition-[background-color,border-color,box-shadow,opacity] duration-150 ease-smooth",
        selected ? ITEM_SELECTED[item.type] : ITEM_COLOR[item.type],
        muted && "opacity-45",
      )}
      style={{ left, width: w }}
      data-selected={selected}
      onPointerDown={(e) => startDrag(e, "move")}
    >
      <TrimHandle side="start" onPointerDown={(e) => startDrag(e, "start")} />
      <ItemLabel item={item} assets={assets} />
      <TrimHandle side="end" onPointerDown={(e) => startDrag(e, "end")} />
    </div>
  );
}
