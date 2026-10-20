"use client";

import { useState, type PointerEvent as ReactPointerEvent } from "react";
import { formatTime } from "@/lib/format";

/** Time ruler: labelled major ticks, minor ticks drawn as a CSS gradient, and a ghost playhead on hover. */
export function TimelineRuler({
  width,
  pxPerSec,
  contentHeight,
  onPointerDown,
  onScrubChange,
}: {
  width: number;
  pxPerSec: number;
  /** Height of ruler + tracks, so the hover guide spans the whole timeline. */
  contentHeight: number;
  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onScrubChange: (scrubbing: boolean) => void;
}) {
  const [hoverX, setHoverX] = useState<number | null>(null);
  const [scrubbing, setScrubbing] = useState(false);

  const tickStep = pxPerSec >= 80 ? 1 : pxPerSec >= 30 ? 2 : pxPerSec >= 12 ? 5 : 10;
  const ticks = Array.from({ length: Math.ceil(width / pxPerSec / tickStep) + 1 }, (_, i) => i * tickStep);
  const minorPx = (tickStep * pxPerSec) / (tickStep === 5 ? 5 : 4);

  return (
    <div
      className="relative h-6 cursor-ew-resize border-b border-separator select-none"
      style={{
        backgroundImage: `repeating-linear-gradient(to right, color-mix(in oklab, var(--color-muted) 30%, transparent) 0 1px, transparent 1px ${minorPx}px)`,
        backgroundSize: "100% 4px",
        backgroundPosition: "left bottom",
        backgroundRepeat: "no-repeat",
      }}
      onPointerDown={(e) => {
        onPointerDown(e);
        setScrubbing(true);
        onScrubChange(true);
        const up = () => {
          window.removeEventListener("pointerup", up);
          setScrubbing(false);
          onScrubChange(false);
        };
        window.addEventListener("pointerup", up);
      }}
      onPointerMove={(e) => setHoverX(e.clientX - e.currentTarget.getBoundingClientRect().left)}
      onPointerLeave={() => setHoverX(null)}
    >
      {ticks.map((t) => (
        <div key={t} className="pointer-events-none absolute inset-y-0" style={{ left: t * pxPerSec }}>
          <div className="absolute bottom-0 h-2.5 w-px bg-muted/50" />
          <span className="absolute top-0.5 left-1 font-mono text-[10px] leading-none text-muted tabular-nums">
            {formatTime(t, 0)}
          </span>
        </div>
      ))}

      {hoverX !== null && !scrubbing && (
        <div className="pointer-events-none absolute top-0 z-10 w-px bg-foreground/25" style={{ left: hoverX, height: contentHeight }}>
          <span className="absolute top-0.5 left-1.5 rounded-sm bg-overlay px-1 py-px font-mono text-[10px] leading-none whitespace-nowrap text-foreground tabular-nums shadow-overlay">
            {formatTime(hoverX / pxPerSec)}
          </span>
        </div>
      )}
    </div>
  );
}
