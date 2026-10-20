"use client";

import { ArrowRight, ArrowUturnCcwLeft, Scissors, ThunderboltFill } from "@gravity-ui/icons";
import { Button, buttonVariants, Card, Chip, Spinner, Tooltip } from "@heroui/react";
import Link from "next/link";
import { ClipPreview, PreviewBadge } from "@/components/media/clip-preview";
import { formatTime } from "@/lib/format";
import type { Moment } from "@/server/db/schema";

function scoreTier(score: number) {
  if (score >= 80) return { label: "Très fort potentiel", color: "success" as const, muted: false };
  if (score >= 60) return { label: "Bon potentiel", color: "default" as const, muted: false };
  return { label: "Potentiel modéré", color: "default" as const, muted: true };
}

export function MomentCard({
  moment: m,
  previewSrc,
  montageId,
  pending,
  disabled,
  onCreate,
}: {
  moment: Moment;
  /** The source's proxy video, played over the moment on hover. */
  previewSrc: string | null;
  /** Montage already made from this moment, if any. */
  montageId?: string;
  pending: boolean;
  disabled: boolean;
  onCreate: () => void;
}) {
  const tier = scoreTier(m.score);
  const duration = Math.round(m.end - m.start);

  return (
    <Card
      variant="secondary"
      className="flex-1 transition-transform duration-200 ease-smooth hover:-translate-y-0.5 motion-reduce:transition-none"
    >
      <ClipPreview src={previewSrc} start={m.start} end={m.end}>
        <PreviewBadge className="end-2 bottom-2">{duration} s</PreviewBadge>
        {m.teaserStart != null && (
          <PreviewBadge className="start-2 bottom-2">
            <ArrowUturnCcwLeft className="size-3" aria-hidden />
            Teaser
          </PreviewBadge>
        )}
        {montageId && (
          <PreviewBadge className="start-2 top-2">
            <Scissors className="size-3" aria-hidden />
            Monté
          </PreviewBadge>
        )}
      </ClipPreview>
      <Card.Header className="flex-row items-start justify-between gap-3">
        <Card.Title className="text-sm leading-snug text-balance">{m.title ?? m.hook}</Card.Title>
        <Tooltip delay={300}>
          <Tooltip.Trigger aria-label={`Score ${m.score} sur 100`}>
            <Chip
              size="sm"
              variant="soft"
              color={tier.color}
              className={tier.muted ? "text-muted tabular-nums" : "tabular-nums"}
            >
              <ThunderboltFill className="size-3" aria-hidden />
              <Chip.Label>{m.score}</Chip.Label>
            </Chip>
          </Tooltip.Trigger>
          <Tooltip.Content>
            {tier.label} · <span className="tabular-nums">{m.score}/100</span>
          </Tooltip.Content>
        </Tooltip>
      </Card.Header>

      <Card.Content className="gap-2">
        {m.title && <p className="text-sm leading-relaxed text-foreground/90">« {m.hook} »</p>}
        <p className="line-clamp-3 text-xs leading-relaxed text-muted">{m.reason}</p>
      </Card.Content>

      <Card.Footer className="mt-auto items-center justify-between">
        <span className="font-mono text-xs text-muted tabular-nums">
          {formatTime(m.start, 0)} → {formatTime(m.end, 0)}
        </span>
        {montageId ? (
          <Link
            href={`/projects/${montageId}`}
            className={buttonVariants({ size: "sm", variant: "tertiary", className: "group" })}
          >
            Ouvrir le montage
            <ArrowRight className="transition-transform duration-200 ease-smooth group-hover:translate-x-0.5" />
          </Link>
        ) : (
          <Button size="sm" className="group" onPress={onCreate} isDisabled={disabled} isPending={pending}>
            {({ isPending }) => (
              <>
                {isPending ? (
                  <Spinner size="sm" color="current" />
                ) : (
                  <Scissors className="transition-transform duration-200 ease-smooth group-hover:-rotate-12 group-hover:scale-110" />
                )}
                {isPending ? "Ouverture…" : "Monter"}
              </>
            )}
          </Button>
        )}
      </Card.Footer>
    </Card>
  );
}
