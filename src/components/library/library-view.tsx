"use client";

import {
  ArrowsRotateRight,
  ChevronDown,
  CircleCheckFill,
  CircleExclamationFill,
  Filmstrip,
  StopFill,
  TrashBin,
} from "@gravity-ui/icons";
import { DropZone, EmptyState, TextShimmer } from "@heroui-pro/react";
import {
  Accordion,
  AlertDialog,
  Button,
  Input,
  Label,
  ProgressBar,
  Skeleton,
  toast,
} from "@heroui/react";
import { useRouter } from "next/navigation";
import { useEffect, useState, type CSSProperties } from "react";
import { fetchJson, formatTime } from "@/lib/format";
import { usePoll } from "@/lib/use-poll";
import type { Job, Moment, Source } from "@/server/db/schema";
import { AnimatedNumber } from "./animated-number";
import { MomentCard } from "./moment-card";
import { STATUS_DETAIL, StatusChip } from "./status-chip";

type SourceRow = Source & { momentCount: number };
type SourceDetail = Source & { moments: Moment[]; activeJob: Job | null; lastJob: Job | null };

const STEP_LABEL: Partial<Record<Job["type"], string>> = {
  ingest: "La préparation de la vidéo",
  transcribe: "La transcription",
  moments: "La recherche des moments",
};
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
  const [openId, setOpenId] = useState<string | null>(null);
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
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-10 px-6 pt-12 pb-16">
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

      <section className="flex animate-fade-in-up flex-col gap-3" style={stagger(2)}>
        <h2 className="text-sm font-semibold">Bibliothèque</h2>
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
          <Accordion
            variant="surface"
            expandedKeys={openId ? [openId] : []}
            onExpandedChange={(keys) => setOpenId((([...keys].find((k) => k !== openId) as string | undefined) ?? null))}
          >
            {sources.map((s, i) => (
              <Accordion.Item key={s.id} id={s.id} className="animate-fade-in-up" style={stagger(i)}>
                <Accordion.Heading>
                  <Accordion.Trigger className="group/row gap-3 transition-[background-color,box-shadow,opacity] duration-200 ease-smooth">
                    <span className="min-w-0 flex-1 truncate text-start font-medium">{s.title}</span>
                    {s.durationSec ? (
                      <span className="font-mono text-xs text-muted tabular-nums">{formatTime(s.durationSec, 0)}</span>
                    ) : null}
                    {s.status === "ready" && (
                      <span className="animate-fade-in text-xs text-muted tabular-nums">
                        {s.momentCount} {s.momentCount > 1 ? "moments" : "moment"}
                      </span>
                    )}
                    <StatusChip status={s.status} />
                    <Accordion.Indicator className="ease-smooth group-hover/row:translate-y-0.5 group-aria-expanded/row:translate-y-0">
                      <ChevronDown />
                    </Accordion.Indicator>
                  </Accordion.Trigger>
                </Accordion.Heading>
                <Accordion.Panel>
                  <Accordion.Body>
                    {openId === s.id && <SourcePanel sourceId={s.id} onDeleted={reloadSources} />}
                  </Accordion.Body>
                </Accordion.Panel>
              </Accordion.Item>
            ))}
          </Accordion>
        )}
      </section>
    </div>
  );
}

function SourcesSkeleton() {
  return (
    <div className="flex flex-col rounded-3xl bg-surface" aria-hidden>
      {[0.5, 0.38, 0.44].map((w, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-4">
          <Skeleton className="h-4 rounded-md" style={{ width: `${w * 100}%` }} />
          <span className="flex-1" />
          <Skeleton className="h-5 w-16 rounded-2xl" />
          <Skeleton className="size-4 rounded-sm" />
        </div>
      ))}
    </div>
  );
}

function PanelSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-hidden>
      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-9 min-w-56 max-w-sm flex-1 rounded-xl" />
        <Skeleton className="h-9 w-44 rounded-xl" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Skeleton className="h-44 rounded-2xl" />
        <Skeleton className="h-44 rounded-2xl" />
      </div>
    </div>
  );
}

function SourcePanel({ sourceId, onDeleted }: { sourceId: string; onDeleted: () => void }) {
  const router = useRouter();
  const [detail, reload] = usePoll<SourceDetail>(`/api/sources/${sourceId}`, 2000);
  const [creating, setCreating] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  const [relaunching, setRelaunching] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    if (savedAt === null) return;
    const t = setTimeout(() => setSavedAt(null), 1800);
    return () => clearTimeout(t);
  }, [savedAt]);

  const cancelJob = async (jobId: string) => {
    setStopping(true);
    try {
      const res = await fetch(`/api/jobs/${jobId}/cancel`, { method: "POST" });
      if (!res.ok && res.status !== 409) toast.danger("Impossible d’arrêter", { description: await res.text() });
      reload();
    } finally {
      setStopping(false);
    }
  };

  const retryJob = async (jobId: string) => {
    setRetrying(true);
    try {
      const res = await fetch(`/api/jobs/${jobId}/retry`, { method: "POST" });
      if (!res.ok) toast.danger("Impossible de réessayer", { description: await res.text() });
      reload();
    } finally {
      setRetrying(false);
    }
  };

  const saveCreator = async (creator: string) => {
    if (creator.trim() === (detail?.creator ?? "")) return;
    const res = await fetch(`/api/sources/${sourceId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ creator: creator.trim() || null }),
    });
    if (!res.ok) toast.danger("Enregistrement impossible", { description: await res.text() });
    else {
      setSavedAt(Date.now());
      reload();
    }
  };

  const findMomentsAgain = async () => {
    setRelaunching(true);
    try {
      const res = await fetch(`/api/sources/${sourceId}/moments`, { method: "POST" });
      if (!res.ok) toast.danger("Impossible de relancer", { description: await res.text() });
      else toast.success("Nouvelle recherche des moments lancée");
      reload();
    } finally {
      setRelaunching(false);
    }
  };

  const createProject = async (momentId: string) => {
    setCreating(momentId);
    try {
      const { id } = await fetchJson<{ id: string }>("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ momentId }),
      });
      router.push(`/projects/${id}`);
    } catch (e) {
      toast.danger(String(e));
      setCreating(null);
    }
  };

  const deleteSource = async () => {
    await fetch(`/api/sources/${sourceId}`, { method: "DELETE" });
    onDeleted();
  };

  if (!detail) return <PanelSkeleton />;
  const { activeJob, lastJob } = detail;
  // The last step of the pipeline failed or was stopped (and nothing runs since): offer a retry.
  const failedJob = !activeJob && lastJob && (lastJob.status === "error" || lastJob.status === "cancelled") ? lastJob : null;

  return (
    <div className="flex animate-fade-in flex-col gap-4">
      {failedJob ? (
        <div
          role="alert"
          className="flex animate-fade-in items-start gap-3 rounded-xl bg-danger-soft p-3 text-danger-soft-foreground"
        >
          <CircleExclamationFill className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <p className="text-sm font-medium">
              {STEP_LABEL[failedJob.type] ?? "L’étape"}{" "}
              {failedJob.status === "cancelled" ? "a été arrêtée" : "a échoué"}
              {failedJob.type === "moments" && detail.moments.length > 0 && " · les moments précédents sont conservés"}
            </p>
            {failedJob.error && <p className="min-w-0 break-words font-mono text-xs">{failedJob.error}</p>}
          </div>
          <Button size="sm" variant="danger" onPress={() => retryJob(failedJob.id)} isPending={retrying}>
            <ArrowsRotateRight />
            Réessayer
          </Button>
        </div>
      ) : (
        detail.error && (
          <p className="flex animate-fade-in items-start gap-2 rounded-xl bg-danger-soft p-3 font-mono text-xs text-danger-soft-foreground">
            <CircleExclamationFill className="mt-px size-3.5 shrink-0" aria-hidden />
            <span className="min-w-0 break-words">{detail.error}</span>
          </p>
        )
      )}

      {activeJob && (
        <div className="flex animate-fade-in-up items-end gap-3">
          <ProgressBar aria-label={STATUS_DETAIL[detail.status]} size="sm" value={activeJob.progress * 100} className="flex-1">
            <Label className="text-xs">
              <TextShimmer key={detail.status} className="animate-fade-in text-foreground">
                {STATUS_DETAIL[detail.status] ?? activeJob.type}
              </TextShimmer>
            </Label>
            <AnimatedNumber
              value={activeJob.progress * 100}
              suffix={" %"}
              className="ms-auto text-xs text-muted tabular-nums"
            />
            <ProgressBar.Track>
              <ProgressBar.Fill className="duration-700 ease-smooth" />
            </ProgressBar.Track>
          </ProgressBar>
          <Button size="sm" variant="ghost" onPress={() => cancelJob(activeJob.id)} isPending={stopping}>
            <StopFill />
            Arrêter
          </Button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex min-w-56 max-w-sm flex-1 items-center">
          <Input
            key={detail.creator ?? ""}
            variant="secondary"
            defaultValue={detail.creator ?? ""}
            placeholder="Nom du créateur (streamer, invité…)"
            aria-label="Nom du créateur, utilisé dans les titres"
            className="w-full"
            onBlur={(e) => saveCreator(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          />
          {savedAt !== null && (
            <CircleCheckFill
              key={savedAt}
              role="status"
              aria-label="Enregistré"
              className="pointer-events-none absolute end-3 size-3.5 animate-scale-in text-success"
            />
          )}
        </div>
        <Button
          variant="tertiary"
          className="group"
          onPress={findMomentsAgain}
          isPending={relaunching}
          isDisabled={!!activeJob || !detail.durationSec}
        >
          <ArrowsRotateRight className="transition-transform duration-300 ease-smooth group-hover:rotate-90" />
          Retrouver les moments
        </Button>
      </div>

      {detail.moments.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2">
          {detail.moments.map((m, i) => (
            <li key={m.id} className="flex animate-fade-in-up" style={stagger(i)}>
              <MomentCard
                moment={m}
                pending={creating === m.id}
                disabled={!!creating}
                onCreate={() => createProject(m.id)}
              />
            </li>
          ))}
        </ul>
      )}

      <div className="flex justify-end">
        <AlertDialog>
          <Button size="sm" variant="danger-soft">
            <TrashBin />
            Supprimer
          </Button>
          <AlertDialog.Backdrop>
            <AlertDialog.Container>
              <AlertDialog.Dialog className="sm:max-w-md">
                <AlertDialog.Header>
                  <AlertDialog.Icon status="danger" />
                  <AlertDialog.Heading>Supprimer cette vidéo ?</AlertDialog.Heading>
                </AlertDialog.Header>
                <AlertDialog.Body>
                  <p>
                    « {detail.title} », ses moments et tous ses fichiers seront supprimés. Cette action est
                    irréversible.
                  </p>
                </AlertDialog.Body>
                <AlertDialog.Footer>
                  <Button slot="close" variant="tertiary">
                    Annuler
                  </Button>
                  <Button slot="close" variant="danger" onPress={deleteSource}>
                    Supprimer
                  </Button>
                </AlertDialog.Footer>
              </AlertDialog.Dialog>
            </AlertDialog.Container>
          </AlertDialog.Backdrop>
        </AlertDialog>
      </div>
    </div>
  );
}
