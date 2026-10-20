import { useLayoutEffect, useRef } from "react";
import { AbsoluteFill, Audio, Html5Video, OffthreadVideo, Sequence, useCurrentFrame } from "remotion";
import { type Box, contentAt, cropTransform, fitTransform, keyframeAt, regionTransform, shotAt } from "@/timeline/crop";
import type { Asset, AudioItem, TextItem, Timeline, VideoItem } from "@/timeline/schema";

/**
 * How asset paths are resolved against the library file server:
 * - "proxy": in-app preview (/api/media, low-res proxies).
 * - "full": render worker (local file server, original files).
 */
export type MediaMode = { baseUrl: string; quality: "proxy" | "full" };

export type ShortProps = {
  timeline: Timeline;
  media: MediaMode;
};

function resolveSrc(asset: Asset, media: MediaMode): string {
  const path = media.quality === "full" ? (asset.renderSrc ?? asset.src) : asset.src;
  return `${media.baseUrl}/${path}`;
}

const toFrames = (sec: number, fps: number) => Math.round(sec * fps);

/**
 * Player only: media items are mounted (loaded and seeked to their first frame, hidden) this long
 * before they start, so a jump cut plays the next clip at once instead of loading it on the cut.
 */
const PREMOUNT_SEC = 1.5;

export function ShortComposition({ timeline, media }: ShortProps) {
  const { fps } = timeline;
  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {timeline.tracks.map((track) => {
        if (track.hidden && track.kind !== "audio") return null;
        return track.items.map((item) => {
          const from = toFrames(item.start, fps);
          const duration =
            item.type === "text"
              ? toFrames(item.duration, fps)
              : toFrames(item.sourceOut - item.sourceIn, fps);
          if (duration <= 0) return null;
          const asset = item.type === "text" ? null : timeline.assets[item.assetId];
          if (item.type !== "text" && !asset) return null;
          return (
            <Sequence
              key={item.id}
              from={from}
              durationInFrames={duration}
              // Premounting needs the default layout; text has nothing to preload.
              {...(item.type === "text" ? { layout: "none" as const } : { premountFor: Math.round(PREMOUNT_SEC * fps) })}
            >
              {item.type === "video" && asset ? (
                <VideoLayer item={item} asset={asset} timeline={timeline} media={media} muted={track.muted} />
              ) : item.type === "audio" && asset ? (
                <AudioLayer item={item} asset={asset} fps={fps} media={media} muted={track.muted} />
              ) : item.type === "text" ? (
                <TextLayer item={item} timeline={timeline} />
              ) : null}
            </Sequence>
          );
        });
      })}
    </AbsoluteFill>
  );
}

function VideoLayer({
  item,
  asset,
  timeline,
  media,
  muted,
}: {
  item: VideoItem;
  asset: Asset;
  timeline: Timeline;
  media: MediaMode;
  muted: boolean;
}) {
  const frame = useCurrentFrame();
  const sourceTime = item.sourceIn + frame / timeline.fps;
  const shot = shotAt(item.crop, sourceTime);
  const src = { width: asset.width ?? 1920, height: asset.height ?? 1080 };
  const W = timeline.width;
  const H = timeline.height;

  // "main" carries the audio and shows the content (split), the speaker (crop) or the whole frame
  // (fit); "aux" is the facecam (split) or the blurred backdrop (fit).
  let main: Slot;
  let aux: Slot | null = null;
  if (shot.layout === "split") {
    const camH = Math.round(H * shot.ratio);
    aux = {
      frame: { left: 0, top: 0, width: W, height: camH },
      box: regionTransform(shot.cam, src, { width: W, height: camH }),
    };
    main = {
      frame: { left: 0, top: camH, width: W, height: H - camH },
      box: regionTransform(contentAt(shot, sourceTime), src, { width: W, height: H - camH }),
    };
  } else if (shot.layout === "fit") {
    const full = { left: 0, top: 0, width: W, height: H };
    // Slightly oversized so the blur's soft edges fall outside the frame (no dark halo).
    aux = { frame: full, box: cropTransform({ t: 0, x: 0.5, y: 0.5, zoom: 1.15 }, src, full), filter: "blur(40px) brightness(0.55)" };
    main = { frame: full, box: fitTransform(src, full) };
  } else {
    const full = { left: 0, top: 0, width: W, height: H };
    main = { frame: full, box: cropTransform(keyframeAt(shot.keyframes, sourceTime), src, full) };
  }
  const usesAux = (s: { layout: string }) => s.layout !== "crop";
  const props = { item, asset, timeline, media, muted, main, aux };

  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      {media.quality === "full" ? (
        // Rendering is frame-exact: the aux slot is a second decoder, only on the shots that use it.
        <RenderVideo {...props} withAux={usesAux(shot)} />
      ) : (
        <PlayerVideo {...props} withAux={item.crop.mode === "auto" && !!item.crop.shots?.some(usesAux)} />
      )}
      {shot.layout === "split" && (
        <div style={{ position: "absolute", left: 0, width: W, top: main.frame.top - 3, height: 6, background: "#000" }} />
      )}
    </AbsoluteFill>
  );
}

type VideoSlotsProps = {
  item: VideoItem;
  asset: Asset;
  timeline: Timeline;
  media: MediaMode;
  muted: boolean;
  main: Slot;
  aux: Slot | null;
  /** Whether the aux slot exists (it may be hidden on the current shot). */
  withAux: boolean;
};

const FULL_FRAME = (W: number, H: number) => ({ left: 0, top: 0, width: W, height: H });

/** Positioned window on the output frame (hidden when its slot is unused on this shot). */
function SlotFrame({ slot, W, H, children }: { slot: Slot | null; W: number; H: number; children: React.ReactNode }) {
  return (
    <div style={{ position: "absolute", overflow: "hidden", ...(slot?.frame ?? FULL_FRAME(W, H)), opacity: slot ? 1 : 0 }}>
      {children}
    </div>
  );
}

const boxStyle = (slot: Slot | null, W: number, H: number) => ({
  position: "absolute" as const,
  ...(slot?.box ?? FULL_FRAME(W, H)),
  maxWidth: "none",
  filter: slot?.filter,
});

/** Render worker: one frame-exact decoder per slot. */
function RenderVideo({ item, asset, timeline, media, muted, main, aux, withAux }: VideoSlotsProps) {
  const { width: W, height: H, fps } = timeline;
  const video = (slot: Slot | null, audible: boolean) => (
    <SlotFrame slot={slot} W={W} H={H}>
      <OffthreadVideo
        src={resolveSrc(asset, media)}
        trimBefore={toFrames(item.sourceIn, fps)}
        volume={audible && !muted ? item.volume : 0}
        muted={!audible}
        style={boxStyle(slot, W, H)}
      />
    </SlotFrame>
  );
  return (
    <>
      {withAux && video(aux, false)}
      {video(main, true)}
    </>
  );
}

/**
 * Player: a single <video> per clip. The aux slot is a canvas painted from that video's own frames,
 * so the facecam and the content can never drift apart — two <video> tags of the same file had to be
 * resynced by seeking, which stalled playback and made it jump back. The canvas is drawn at reduced
 * resolution (the preview plays a 540p proxy; the backdrop is blurred anyway).
 */
function PlayerVideo({ item, asset, timeline, media, muted, main, aux, withAux }: VideoSlotsProps) {
  const { width: W, height: H, fps } = timeline;
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const auxRef = useRef(aux);

  const paint = (frame: CanvasImageSource) => {
    const canvas = canvasRef.current;
    const slot = auxRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !slot || !ctx) return;
    const k = slot.filter ? 1 / 8 : 1 / 2;
    const w = Math.max(1, Math.round(slot.frame.width * k));
    const h = Math.max(1, Math.round(slot.frame.height * k));
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    ctx.drawImage(frame, slot.box.left * k, slot.box.top * k, slot.box.width * k, slot.box.height * k);
  };

  // New geometry (pan, shot change, scrub while paused): repaint from the frame on screen.
  useLayoutEffect(() => {
    auxRef.current = aux;
    const video = videoRef.current;
    if (video && video.readyState >= 2) paint(video);
  });

  return (
    <>
      {withAux && (
        <SlotFrame slot={aux} W={W} H={H}>
          <canvas
            ref={canvasRef}
            style={{ position: "absolute", left: 0, top: 0, width: "100%", height: "100%", filter: aux?.filter }}
          />
        </SlotFrame>
      )}
      <SlotFrame slot={main} W={W} H={H}>
        <Html5Video
          ref={videoRef}
          src={resolveSrc(asset, media)}
          trimBefore={toFrames(item.sourceIn, fps)}
          volume={muted ? 0 : item.volume}
          pauseWhenBuffering
          onVideoFrame={withAux ? paint : undefined}
          style={boxStyle(main, W, H)}
        />
      </SlotFrame>
    </>
  );
}

type Slot = {
  frame: { left: number; top: number; width: number; height: number };
  box: Box;
  filter?: string;
};

function AudioLayer({
  item,
  asset,
  fps,
  media,
  muted,
}: {
  item: AudioItem;
  asset: Asset;
  fps: number;
  media: MediaMode;
  muted: boolean;
}) {
  return (
    <Audio
      src={resolveSrc(asset, media)}
      trimBefore={toFrames(item.sourceIn, fps)}
      volume={muted ? 0 : item.volume}
      pauseWhenBuffering
    />
  );
}

function TextLayer({ item, timeline }: { item: TextItem; timeline: Timeline }) {
  const { style } = item;
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          left: item.x * timeline.width,
          top: item.y * timeline.height,
          transform: "translate(-50%, -50%)",
          width: item.maxWidth * timeline.width,
          textAlign: style.align,
          fontFamily: "Inter, system-ui, sans-serif",
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
          lineHeight: 1.1,
          letterSpacing: "-0.02em",
          color: style.color,
          textShadow: style.background ? undefined : "0 4px 24px rgba(0,0,0,0.55)",
        }}
      >
        <span
          style={{
            background: style.background ?? undefined,
            padding: style.background ? "0.08em 0.3em" : undefined,
            borderRadius: 16,
            boxDecorationBreak: "clone",
            WebkitBoxDecorationBreak: "clone",
          }}
        >
          {item.text}
        </span>
      </div>
    </AbsoluteFill>
  );
}
