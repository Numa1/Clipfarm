import { AbsoluteFill, Audio, OffthreadVideo, Sequence, useCurrentFrame } from "remotion";
import { cropAt, cropTransform } from "@/timeline/crop";
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
  const kf = cropAt(item.crop, sourceTime);
  const box = cropTransform(
    kf,
    { width: asset.width ?? 1920, height: asset.height ?? 1080 },
    { width: timeline.width, height: timeline.height },
  );
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <OffthreadVideo
        src={resolveSrc(asset, media)}
        trimBefore={toFrames(item.sourceIn, timeline.fps)}
        volume={muted ? 0 : item.volume}
        pauseWhenBuffering
        style={{
          position: "absolute",
          width: box.width,
          height: box.height,
          left: box.left,
          top: box.top,
          maxWidth: "none",
        }}
      />
    </AbsoluteFill>
  );
}

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
