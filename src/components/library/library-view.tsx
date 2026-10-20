"use client";

import { CircleCheckFill, Filmstrip } from "@gravity-ui/icons";
import { DropZone, EmptyState } from "@heroui-pro/react";
import { Skeleton, toast } from "@heroui/react";
import { useState, type CSSProperties } from "react";
import { formatUsd } from "@/lib/format";
import { usePoll } from "@/lib/use-poll";
import { AnimatedNumber } from "./animated-number";
import { type SourceRow, VideoCard } from "./video-card";

type Upload = { name: string; size: number; progress: number; done?: boolean };

// Entrance stagger: CSS animations only run on mount, so polling re-renders never replay them.
const stagger = (i: number): CSSProperties => ({ animationDelay: `${Math.min(i, 6) * 40}ms` });

const SIZE_UNITS = ["o", "Ko", "Mo", "Go"];
function formatSize(bytes: number) {
  let v = bytes;
  let u = 0;
  while (v >= 1024 && u < SIZE_UNITS.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v.toLocaleString("fr-FR", { maximumFractionDigits: u >= 2 ? 1 : 0 })} ${SIZE_UNITS[u]}`;
}

export function LibraryView() {
  const [sources, reloadSources] = usePoll<SourceRow[]>("/api/sources", 2000);
  const [upload, setUpload] = useState<Upload | null>(null);

  // XHR rather than fetch: we want upload progress on multi-GB files.
  const uploadFile = (file: File) => {
    setUpload({ name: file.name, size: file.size, progress: 0 });
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/sources");
    xhr.setRequestHeader("x-filename", encodeURIComponent(file.name));
    xhr.upload.onprogress = (e) =>
      e.lengthComputable && setUpload({ name: file.name, size: file.size, progress: e.loaded / e.total });
    xhr.onload = () => {
      if (xhr.status >= 300) {
        setUpload(null);
        toast.danger("Échec de l’import", { description: xhr.responseText });
      } else {
        // Hold the completed row briefly so the upload ends on a visible success, not a vanish.
        setUpload({ name: file.name, size: file.size, progress: 1, done: true });
        setTimeout(() => setUpload(null), 1400);
        toast.success("Vidéo importée", { description: `${file.name} · l’analyse démarre.` });
        reloadSources();
      }
    };
    xhr.onerror = () => {
      setUpload(null);
      toast.danger("Échec de l’import");
    };
    xhr.send(file);
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-6 pt-12 pb-16">
      <header className="flex animate-fade-in-up flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Vidéos</h1>
        <p className="text-sm text-muted">Tes vidéos longues, découpées en shorts 9:16 en quelques minutes.</p>
      </header>

      <DropZone className="animate-fade-in-up" style={stagger(1)}>
        <DropZone.Area
          isDisabled={!!upload}
          className="group/drop data-[drop-target]:scale-[1.01] transition-[background-color,border-color,scale] duration-200 ease-smooth"
          onDrop={async (e) => {
            const item = e.items.find((i) => i.kind === "file");
            if (item?.kind !== "file") return;
            if (!item.type.startsWith("video/")) toast.danger("Ce fichier n’est pas une vidéo");
            else uploadFile(await item.getFile());
          }}
        >
          <DropZone.Icon className="transition-transform duration-300 ease-smooth group-data-[drop-target]/drop:-translate-y-1 group-data-[drop-target]/drop:text-foreground" />
          <DropZone.Label>Glisse une vidéo longue ici</DropZone.Label>
          <DropZone.Description>Podcast, interview, stream… MP4, MOV ou MKV.</DropZone.Description>
          <DropZone.Trigger>Choisir une vidéo</DropZone.Trigger>
        </DropZone.Area>
        <DropZone.Input
          accept="video/*"
          onSelect={(files) => {
            const file = files[0];
            if (file) uploadFile(file);
          }}
        />
        {upload && (
          <DropZone.FileList>
            <DropZone.FileItem status={upload.done ? "complete" : "uploading"} className="animate-fade-in-up">
              <DropZone.FileFormatIcon format={upload.name.split(".").pop()?.toUpperCase() ?? "MP4"} />
              <DropZone.FileInfo>
                <DropZone.FileName>{upload.name}</DropZone.FileName>
                <DropZone.FileMeta className="tabular-nums">
                  {upload.done ? (
                    <span key="done" className="flex animate-fade-in items-center gap-1 text-success">
                      <CircleCheckFill className="size-3 animate-scale-in" aria-hidden />
                      Importée
                    </span>
                  ) : (
                    <>
                      {formatSize(upload.size)} · <AnimatedNumber value={upload.progress * 100} suffix={" %"} />
                    </>
                  )}
                </DropZone.FileMeta>
              </DropZone.FileInfo>
              <DropZone.FileProgress aria-label="Progression de l’import" value={upload.progress * 100}>
                <DropZone.FileProgressTrack>
                  <DropZone.FileProgressFill />
                </DropZone.FileProgressTrack>
              </DropZone.FileProgress>
            </DropZone.FileItem>
          </DropZone.FileList>
        )}
      </DropZone>

      <section className="flex animate-fade-in-up flex-col gap-4" style={stagger(2)}>
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold">Bibliothèque</h2>
          {sources && sources.length > 0 && <LibraryStats sources={sources} />}
        </div>
        {sources === null ? (
          <SourcesSkeleton />
        ) : sources.length === 0 ? (
          <EmptyState size="sm" className="animate-fade-in">
            <EmptyState.Header>
              <EmptyState.Media variant="icon">
                <Filmstrip />
              </EmptyState.Media>
              <EmptyState.Title>Aucune vidéo pour l’instant</EmptyState.Title>
              <EmptyState.Description>Importe une vidéo longue pour en extraire les meilleurs moments.</EmptyState.Description>
            </EmptyState.Header>
          </EmptyState>
        ) : (
          <ul className="grid gap-x-5 gap-y-7 sm:grid-cols-2 xl:grid-cols-3">
            {sources.map((s, i) => (
              <li key={s.id} className="animate-fade-in-up" style={stagger(i)}>
                <VideoCard source={s} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** One line of totals: shorts exported and what the analyses would have cost at API prices. */
function LibraryStats({ sources }: { sources: SourceRow[] }) {
  const exports = sources.reduce((n, s) => n + s.exportCount, 0);
  const tracked = sources.filter((s) => s.cost.calls > 0);
  const cost = tracked.reduce((n, s) => n + s.cost.costUsd, 0);
  return (
    <p className="text-xs text-muted tabular-nums">
      {exports} short{exports > 1 ? "s" : ""} exporté{exports > 1 ? "s" : ""}
      {tracked.length > 0 && <> · ≈ {formatUsd(cost)} d’analyse</>}
    </p>
  );
}

function SourcesSkeleton() {
  return (
    <div className="grid gap-x-5 gap-y-7 sm:grid-cols-2 xl:grid-cols-3" aria-hidden>
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex flex-col gap-3">
          <Skeleton className="aspect-video rounded-xl" />
          <Skeleton className="h-4 w-3/4 rounded-md" />
          <Skeleton className="h-3 w-1/2 rounded-md" />
        </div>
      ))}
    </div>
  );
}
