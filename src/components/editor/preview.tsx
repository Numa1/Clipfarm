"use client";

import { Player, type CallbackListener, type PlayerRef } from "@remotion/player";
import { Chip } from "@heroui/react";
import { useEffect, useMemo, type RefObject } from "react";
import { ShortComposition, type ShortProps } from "@/remotion/ShortComposition";
import { durationInFrames } from "@/timeline/ops";
import { useEditor } from "./store";

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

export function Preview({ ref }: { ref: RefObject<PlayerRef | null> }) {
  const timeline = useEditor((s) => s.timeline)!;
  const setPlayhead = useEditor((s) => s.setPlayhead);
  const inputProps = useMemo<ShortProps>(
    () => ({ timeline, media: { baseUrl: "/api/media", quality: "proxy" } }),
    [timeline],
  );

  // Player → store (playhead follows playback).
  useEffect(() => {
    const player = ref.current;
    if (!player) return;
    const onFrame: CallbackListener<"frameupdate"> = (e) => setPlayhead(e.detail.frame / timeline.fps);
    const onSeek: CallbackListener<"seeked"> = (e) => setPlayhead(e.detail.frame / timeline.fps);
    player.addEventListener("frameupdate", onFrame);
    player.addEventListener("seeked", onSeek);
    return () => {
      player.removeEventListener("frameupdate", onFrame);
      player.removeEventListener("seeked", onSeek);
    };
  }, [ref, setPlayhead, timeline.fps]);

  const { width, height } = timeline;
  const ratio = `${width / gcd(width, height)}:${height / gcd(width, height)}`;

  return (
    <div className="flex min-w-0 flex-1 items-center justify-center bg-black/30 p-6">
      <div className="group relative aspect-[9/16] h-full max-h-full animate-fade-in overflow-hidden rounded-xl shadow-overlay ring-1 ring-white/10">
        <Player
          ref={ref}
          component={ShortComposition}
          inputProps={inputProps}
          durationInFrames={durationInFrames(timeline)}
          fps={timeline.fps}
          compositionWidth={timeline.width}
          compositionHeight={timeline.height}
          style={{ width: "100%", height: "100%" }}
          controls
          clickToPlay
          doubleClickToFullscreen
          acknowledgeRemotionLicense
        />
        <Chip
          size="sm"
          className="pointer-events-none absolute top-2.5 right-2.5 bg-black/45 font-mono text-white/85 tabular-nums opacity-0 ring-1 ring-white/10 backdrop-blur-md transition-opacity duration-200 ease-smooth group-hover:opacity-100"
        >
          <Chip.Label>
            {ratio} · {width}×{height}
          </Chip.Label>
        </Chip>
      </div>
    </div>
  );
}
