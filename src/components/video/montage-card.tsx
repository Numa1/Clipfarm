"use client";

import { ArrowDownToLine, CircleCheckFill, Pencil } from "@gravity-ui/icons";
import { Button, Tooltip } from "@heroui/react";
import Link from "next/link";
import { ClipPreview, PreviewBadge } from "@/components/media/clip-preview";
import { CostChip } from "@/components/media/cost-chip";
import { splitProjectName } from "@/components/projects/format";
import { relativeTime } from "@/lib/relative-time";
import type { SourceCost } from "@/lib/cost";

function download(path: string) {
  const a = document.createElement("a");
  a.href = `/api/media/${path}`;
  a.download = "";
  a.click();
}

export type MontageRow = {
  id: string;
  name: string;
  momentId: string | null;
  updatedAt: string;
  lastExportPath: string | null;
  /** Source range of the first clip, previewed for drafts. */
  preview: { start: number; end: number } | null;
};

/**
 * A montage as a 9:16 card: the exported short plays on hover; a draft shows its first clip
 * from the source (centre-cropped like the default framing).
 */
export function MontageCard({
  montage: p,
  proxy,
  cost,
  now,
}: {
  montage: MontageRow;
  /** The source's proxy video, previewed over the first clip for drafts with no export yet. */
  proxy: string | null;
  cost: SourceCost | null;
  now: number;
}) {
  const { title } = splitProjectName(p.name);
  const exported = Boolean(p.lastExportPath);

  return (
    <div className="group/card relative flex flex-col gap-2.5">
      <Link
        href={`/projects/${p.id}`}
        aria-label={`Ouvrir le montage « ${title} »`}
        className="rounded-xl outline-none transition-transform duration-200 ease-smooth focus-visible:ring-2 focus-visible:ring-focus group-hover/card:-translate-y-0.5"
      >
        <ClipPreview
          aspect="short"
          src={exported ? `/api/media/${p.lastExportPath}` : p.preview && proxy}
          start={exported ? 0 : p.preview?.start}
          end={exported ? undefined : p.preview?.end}
        >
          <PreviewBadge className="start-2 top-2">
            {exported ? (
              <>
                <CircleCheckFill className="size-3 text-success" aria-hidden />
                Exporté
              </>
            ) : (
              <>
                <Pencil className="size-3" aria-hidden />
                Brouillon
              </>
            )}
          </PreviewBadge>
        </ClipPreview>
      </Link>
      {exported && (
        <Tooltip delay={300}>
          <Button
            size="sm"
            isIconOnly
            variant="tertiary"
            aria-label="Télécharger le MP4"
            onPress={() => download(p.lastExportPath!)}
            className="absolute end-2 top-2 scale-90 bg-black/55 text-white opacity-0 backdrop-blur-md transition-[opacity,scale] duration-200 ease-snappy group-hover/card:scale-100 group-hover/card:opacity-100 data-[focus-visible=true]:opacity-100"
          >
            <ArrowDownToLine />
          </Button>
          <Tooltip.Content>Télécharger le MP4</Tooltip.Content>
        </Tooltip>
      )}
      <div className="flex flex-col gap-1.5 px-0.5">
        <p className="line-clamp-2 text-sm leading-snug font-medium text-balance">{title}</p>
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-xs text-muted tabular-nums">
            {now ? `Modifié ${relativeTime(p.updatedAt, now)}` : " "}
          </span>
          <CostChip cost={cost} share />
        </div>
      </div>
    </div>
  );
}
