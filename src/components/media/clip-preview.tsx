"use client";

import { Filmstrip, Play } from "@gravity-ui/icons";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A still frame of `src` at `start`, playing muted in a loop over [start, end] while hovered.
 * The video only loads once the card scrolls into view, so long grids stay light.
 */
export function ClipPreview({
  src,
  start = 0,
  end,
  aspect = "video",
  className,
  children,
}: {
  src: string | null;
  start?: number;
  end?: number;
  aspect?: "video" | "short";
  className?: string;
  /** Overlays (chips, duration…) drawn over the frame. */
  children?: ReactNode;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [visible, setVisible] = useState(false);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setVisible(true), { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const stop = start + 0.01;
  const play = () => {
    const v = ref.current;
    if (!v || !ready) return;
    void v.play().catch(() => {});
    setPlaying(true);
  };
  const pause = () => {
    const v = ref.current;
    if (!v) return;
    v.pause();
    v.currentTime = stop;
    setPlaying(false);
    setProgress(0);
  };

  return (
    <div
      className={cn(
        "group/preview relative overflow-hidden rounded-xl bg-black ring-1 ring-white/10",
        aspect === "short" ? "aspect-[9/16]" : "aspect-video",
        className,
      )}
      onPointerEnter={play}
      onPointerLeave={pause}
    >
      <video
        ref={ref}
        src={visible && src ? `${src}#t=${stop}` : undefined}
        muted
        playsInline
        preload="metadata"
        className={cn(
          "size-full object-cover transition-[opacity,scale] duration-500 ease-smooth",
          ready ? "opacity-100" : "opacity-0",
          playing && "scale-[1.03]",
        )}
        onLoadedData={() => setReady(true)}
        onTimeUpdate={(e) => {
          const v = e.currentTarget;
          const until = end ?? v.duration;
          if (v.currentTime >= until) v.currentTime = stop;
          setProgress(until > start ? (v.currentTime - start) / (until - start) : 0);
        }}
      />
      {!ready && (
        <div className={cn("absolute inset-0 grid place-items-center bg-surface-secondary", src && "animate-pulse")} aria-hidden>
          {!src && <Filmstrip className="size-5 text-muted/50" />}
        </div>
      )}
      {src && ready && (
        <div
          className={cn(
            "pointer-events-none absolute inset-0 grid place-items-center transition-opacity duration-300 ease-smooth",
            playing ? "opacity-0" : "opacity-100",
          )}
          aria-hidden
        >
          <span className="grid size-9 place-items-center rounded-full bg-black/45 text-white ring-1 ring-white/15 backdrop-blur-md transition-transform duration-300 ease-snappy group-hover/preview:scale-110">
            <Play className="ms-0.5 size-3.5" />
          </span>
        </div>
      )}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/60 to-transparent" aria-hidden />
      {children}
      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 bottom-0 h-0.5 origin-left bg-white/80 transition-opacity duration-200",
          playing ? "opacity-100" : "opacity-0",
        )}
        style={{ transform: `scaleX(${progress})` }}
        aria-hidden
      />
    </div>
  );
}

/** Small pill drawn over a preview (duration, status…). */
export function PreviewBadge({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <span
      className={cn(
        "absolute flex items-center gap-1 rounded-md bg-black/55 px-1.5 py-0.5 text-[11px] font-medium text-white tabular-nums ring-1 ring-white/10 backdrop-blur-md",
        className,
      )}
    >
      {children}
    </span>
  );
}
