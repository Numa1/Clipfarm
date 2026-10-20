import { AbsoluteFill, Audio, OffthreadVideo, Sequence, useCurrentFrame } from "remotion";
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
            <Sequence key={item.id} from={from} durationInFrames={duration} layout="none">
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

  // "main" carries the audio, "aux" is the facecam (split) or the blurred backdrop (fit).
  // In the player, both slots stay mounted for clips that have split/fit shots, so a layout switch
  // is a cut, not a <video> remount (reload/stutter). Rendering is frame-exact, so there the aux
  // slot only exists on the shots that use it (no decoding it for nothing).
  const usesAux = (s: { layout: string }) => s.layout !== "crop";
  const needsAux =
    media.quality === "full"
      ? usesAux(shot)
      : item.crop.mode === "auto" && !!item.crop.shots?.some(usesAux);
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

  const video = (slot: Slot | null, audible: boolean) => (
    <div
      style={{
        position: "absolute",
        overflow: "hidden",
        ...(slot?.frame ?? { left: 0, top: 0, width: W, height: H }),
        opacity: slot ? 1 : 0,
      }}
    >
      <OffthreadVideo
        src={resolveSrc(asset, media)}
        trimBefore={toFrames(item.sourceIn, timeline.fps)}
        volume={audible && !muted ? item.volume : 0}
        muted={!audible}
        // Both slots must stay lip-synced with each other (the default tolerance is 0.45 s each).
        acceptableTimeShiftInSeconds={needsAux ? 0.04 : undefined}
        pauseWhenBuffering
        style={{
          position: "absolute",
          ...(slot?.box ?? { left: 0, top: 0, width: W, height: H }),
          maxWidth: "none",
          filter: slot?.filter,
        }}
      />
    </div>
  );

  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      {needsAux && video(aux, false)}
      {video(main, true)}
      {shot.layout === "split" && (
        <div style={{ position: "absolute", left: 0, width: W, top: main.frame.top - 3, height: 6, background: "#000" }} />
      )}
    </AbsoluteFill>
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
