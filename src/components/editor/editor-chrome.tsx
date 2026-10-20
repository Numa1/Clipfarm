"use client";

import { ArrowUpFromSquare, Check, ChevronRight, CloudArrowUpIn, CloudCheck, CloudSlash } from "@gravity-ui/icons";
import { TextShimmer } from "@heroui-pro/react";
import { Button, cn, Spinner } from "@heroui/react";
import { motion, useReducedMotion, useSpring, useTransform } from "motion/react";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { fetchJson } from "@/lib/format";

/** Stacked crossfade layer: every state stays mounted in the same grid cell, so the width never jumps. */
function layer(on: boolean, className?: string) {
  return cn(
    "[grid-area:1/1] transition-[opacity,transform] duration-200 ease-smooth",
    on ? "opacity-100" : "pointer-events-none scale-90 opacity-0",
    className,
  );
}

function Layer({ on, className, children }: { on: boolean; className?: string; children: ReactNode }) {
  return (
    <span aria-hidden={!on} className={layer(on, className)}>
      {children}
    </span>
  );
}

/** Integer that eases towards its target; drops instantly when it goes back (a new run starts at 0). */
export function AnimatedNumber({ value }: { value: number }) {
  const reduce = useReducedMotion();
  const spring = useSpring(value, { stiffness: 120, damping: 22, mass: 0.6 });
  const text = useTransform(spring, (v) => String(Math.round(v)));
  useEffect(() => {
    if (reduce || value < spring.get()) spring.jump(value);
    else spring.set(value);
  }, [reduce, spring, value]);
  return <motion.span className="tabular-nums">{text}</motion.span>;
}

/** Breadcrumb: the source video (a link back to its page), then the montage in front. */
export function ProjectTitle({ name, sourceId }: { name: string; sourceId: string | null }) {
  const sep = name.indexOf(" — ");
  const title = sep > 0 ? name.slice(sep + 3) : name;
  // Older names embed the source ("source — moment"); newer ones are the moment's title only.
  const [sourceTitle, setSourceTitle] = useState<string | null>(sep > 0 ? name.slice(0, sep) : null);
  useEffect(() => {
    if (!sourceId || sep > 0) return;
    fetchJson<{ title: string }>(`/api/sources/${sourceId}`)
      .then((s) => setSourceTitle(s.title))
      .catch(() => {});
  }, [sourceId, sep]);
  return (
    <h1 key={name} title={name} className="flex min-w-0 animate-fade-in items-center gap-1.5 text-sm">
      {sourceTitle && (
        <>
          {sourceId ? (
            <Link
              href={`/videos/${sourceId}`}
              className="max-w-[40%] shrink truncate text-muted transition-colors duration-150 hover:text-foreground"
            >
              {sourceTitle}
            </Link>
          ) : (
            <span className="max-w-[40%] shrink truncate text-muted">{sourceTitle}</span>
          )}
          <ChevronRight aria-hidden className="size-3 shrink-0 text-muted/60" />
        </>
      )}
      <span className="min-w-0 truncate font-semibold">{title}</span>
    </h1>
  );
}

export type SaveStatus = "saved" | "saving" | "error";

export function SaveIndicator({ status }: { status: SaveStatus }) {
  const label = { saved: "Enregistré", saving: "Enregistrement…", error: "Non enregistré" }[status];
  return (
    <span className="hidden shrink-0 items-center gap-1.5 text-xs text-muted sm:inline-flex">
      <span role="status" className="sr-only">
        {label}
      </span>
      <span aria-hidden className="grid size-3.5 place-items-center [&_svg]:size-3.5">
        <Layer on={status === "saving"}>
          <CloudArrowUpIn />
        </Layer>
        <Layer on={status === "saved"}>
          <CloudCheck />
        </Layer>
        <Layer on={status === "error"} className="text-danger">
          <CloudSlash />
        </Layer>
      </span>
      <span aria-hidden className="grid justify-items-start">
        <Layer on={status === "saving"}>
          <TextShimmer>Enregistrement…</TextShimmer>
        </Layer>
        <Layer on={status === "saved"}>Enregistré</Layer>
        <Layer on={status === "error"} className="text-danger">
          Non enregistré
        </Layer>
      </span>
    </span>
  );
}

export type ExportState = "idle" | "exporting" | "done";

/** The export CTA morphs in place: label → live percentage (with a fill) → brief confirmation. */
export function ExportButton({
  state,
  progress,
  isDisabled,
  onPress,
}: {
  state: ExportState;
  progress: number;
  isDisabled?: boolean;
  onPress: () => void;
}) {
  const exporting = state === "exporting";
  return (
    <Button
      size="sm"
      onPress={onPress}
      isDisabled={isDisabled}
      isPending={exporting}
      aria-label={exporting ? `Export en cours, ${Math.round(progress * 100)} %` : state === "done" ? "Exporté" : "Exporter"}
      className="overflow-hidden"
    >
      <span
        aria-hidden
        className={cn(
          "absolute inset-0 -z-10 origin-left bg-accent-foreground/10 transition-[transform,opacity] duration-700 ease-smooth",
          exporting ? "opacity-100" : "opacity-0",
        )}
        style={{ transform: `scaleX(${exporting ? progress : 0})` }}
      />
      <span className="grid justify-items-center">
        <Layer on={state === "idle"} className="inline-flex items-center gap-1.5">
          <ArrowUpFromSquare className="size-3.5" />
          Exporter
        </Layer>
        <Layer on={exporting} className="inline-flex items-center gap-1.5">
          <Spinner size="sm" color="current" className="size-3.5" />
          <span>
            <AnimatedNumber value={exporting ? Math.round(progress * 100) : 0} /> %
          </span>
        </Layer>
        <Layer on={state === "done"} className="inline-flex items-center gap-1.5">
          <Check className={cn("size-3.5", state === "done" && "animate-scale-in")} />
          Exporté
        </Layer>
      </span>
    </Button>
  );
}
