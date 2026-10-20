"use client";

import { Scissors, ThunderboltFill } from "@gravity-ui/icons";
import Link from "next/link";
import { ClipPreview, PreviewBadge } from "@/components/media/clip-preview";
import { CostChip } from "@/components/media/cost-chip";
import type { SourceCost } from "@/lib/cost";
import { formatTime } from "@/lib/format";
import type { Source } from "@/server/db/schema";
import { StatusChip } from "./status-chip";

export type SourceRow = Source & {
  momentCount: number;
  projectCount: number;
  exportCount: number;
  cost: SourceCost;
};

/** A source video as a project card: hover plays a stretch from a tenth of the way in. */
export function VideoCard({ source: s }: { source: SourceRow }) {
  const start = (s.durationSec ?? 0) * 0.1;
  return (
    <Link
      href={`/videos/${s.id}`}
      className="group/card flex flex-col gap-3 rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-focus"
    >
      <ClipPreview
        src={s.proxyPath ? `/api/media/${s.proxyPath}` : null}
        start={start}
        end={start + 12}
        className="transition-transform duration-300 ease-smooth group-hover/card:-translate-y-0.5"
      >
        {s.status !== "ready" && (
          <span className="absolute start-2 top-2">
            <StatusChip status={s.status} />
          </span>
        )}
        {s.durationSec ? (
          <PreviewBadge className="end-2 bottom-2 font-mono">{formatTime(s.durationSec, 0)}</PreviewBadge>
        ) : null}
      </ClipPreview>
      <div className="flex flex-col gap-1.5 px-0.5">
        <p className="line-clamp-2 text-sm leading-snug font-medium text-balance">{s.title}</p>
        <div className="flex items-center justify-between gap-2 text-xs text-muted">
          <span className="flex items-center gap-3 tabular-nums">
            <span className="flex items-center gap-1">
              <ThunderboltFill className="size-3" aria-hidden />
              {s.momentCount} {s.momentCount > 1 ? "moments" : "moment"}
            </span>
            <span className="flex items-center gap-1">
              <Scissors className="size-3" aria-hidden />
              {s.projectCount} {s.projectCount > 1 ? "montages" : "montage"}
            </span>
          </span>
          {s.status === "ready" && <CostChip cost={s.cost} />}
        </div>
      </div>
    </Link>
  );
}
