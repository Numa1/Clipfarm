"use client";

import { Player, type CallbackListener, type PlayerRef } from "@remotion/player";
import { useEffect, useMemo, type RefObject } from "react";
import { ShortComposition, type ShortProps } from "@/remotion/ShortComposition";
import { durationInFrames } from "@/timeline/ops";
import { useEditor } from "./store";

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

  return (
    <div className="flex min-w-0 flex-1 items-center justify-center bg-black/40 p-4">
      <div className="aspect-[9/16] h-full max-h-full overflow-hidden rounded-lg shadow-2xl ring-1 ring-white/10">
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
      </div>
    </div>
  );
}
