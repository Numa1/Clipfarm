"use client";

import { ArrowsRotateRight, ChevronDown, Filmstrip, Scissors, StopFill, TrashBin } from "@gravity-ui/icons";
import { EmptyState, DropZone } from "@heroui-pro/react";
import {
  Accordion,
  AlertDialog,
  Button,
  Card,
  Chip,
  Input,
  Label,
  ProgressBar,
  Spinner,
  Tooltip,
  toast,
} from "@heroui/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { fetchJson, formatTime } from "@/lib/format";
import { usePoll } from "@/lib/use-poll";
import type { Job, Moment, Source, SourceStatus } from "@/server/db/schema";

type SourceRow = Source & { momentCount: number };
type SourceDetail = Source & { moments: Moment[]; activeJob: Job | null };

const STATUS_LABEL: Record<SourceStatus, string> = {
  uploaded: "En file",
  ingesting: "Préparation",
  transcribing: "Transcription",
  analyzing: "Recherche des moments",
  ready: "Prêt",
  error: "Erreur",
};

export function LibraryView() {
  const [sources, reloadSources] = usePoll<SourceRow[]>("/api/sources", 2000);
  const [openId, setOpenId] = useState<string | null>(null);
  const [upload, setUpload] = useState<{ name: string; progress: number } | null>(null);

  // XHR rather than fetch: we want upload progress on multi-GB files.
  const uploadFile = (file: File) => {
    setUpload({ name: file.name, progress: 0 });
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/sources");
    xhr.setRequestHeader("x-filename", encodeURIComponent(file.name));
    xhr.upload.onprogress = (e) => e.lengthComputable && setUpload({ name: file.name, progress: e.loaded / e.total });
    xhr.onload = () => {
      setUpload(null);
      if (xhr.status >= 300) toast.danger("Upload échoué", { description: xhr.responseText });
      else {
        toast.success(`${file.name} importé`, { description: "Le traitement démarre." });
        reloadSources();
      }
    };
    xhr.onerror = () => {
      setUpload(null);
      toast.danger("Upload échoué");
    };
    xhr.send(file);
  };

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-10 px-6 pt-12 pb-16">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Clipfarm</h1>
        <p className="text-sm text-muted">Vidéos longues → shorts 9:16 en quelques minutes.</p>
      </header>

      <DropZone>
        <DropZone.Area
          isDisabled={!!upload}
          onDrop={async (e) => {
            const item = e.items.find((i) => i.kind === "file");
            if (item?.kind !== "file") return;
            if (!item.type.startsWith("video/")) toast.danger("Ce fichier n’est pas une vidéo");
            else uploadFile(await item.getFile());
          }}
        >
          <DropZone.Icon />
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
            <DropZone.FileItem status="uploading">
              <DropZone.FileFormatIcon format={upload.name.split(".").pop()?.toUpperCase() ?? "MP4"} />
              <DropZone.FileInfo>
                <DropZone.FileName>{upload.name}</DropZone.FileName>
                <DropZone.FileMeta className="tabular-nums">{Math.round(upload.progress * 100)} %</DropZone.FileMeta>
              </DropZone.FileInfo>
              <DropZone.FileProgress aria-label="Progression de l’upload" value={upload.progress * 100}>
                <DropZone.FileProgressTrack>
                  <DropZone.FileProgressFill />
                </DropZone.FileProgressTrack>
              </DropZone.FileProgress>
            </DropZone.FileItem>
          </DropZone.FileList>
        )}
      </DropZone>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Bibliothèque</h2>
        {sources?.length === 0 ? (
          <EmptyState size="sm">
            <EmptyState.Header>
              <EmptyState.Media variant="icon">
                <Filmstrip />
              </EmptyState.Media>
              <EmptyState.Title>Aucune vidéo</EmptyState.Title>
              <EmptyState.Description>Importe une vidéo longue pour trouver ses meilleurs moments.</EmptyState.Description>
            </EmptyState.Header>
          </EmptyState>
        ) : (
          <Accordion
            variant="surface"
            expandedKeys={openId ? [openId] : []}
            onExpandedChange={(keys) => setOpenId((([...keys].find((k) => k !== openId) as string | undefined) ?? null))}
          >
            {sources?.map((s) => (
              <Accordion.Item key={s.id} id={s.id}>
                <Accordion.Heading>
                  <Accordion.Trigger className="gap-3">
                    <span className="min-w-0 flex-1 truncate text-start font-medium">{s.title}</span>
                    {s.durationSec ? (
                      <span className="font-mono text-xs text-muted tabular-nums">{formatTime(s.durationSec, 0)}</span>
                    ) : null}
                    {s.status === "ready" && (
                      <span className="text-xs text-muted tabular-nums">{s.momentCount} moments</span>
                    )}
                    <StatusChip status={s.status} />
                    <Accordion.Indicator>
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

    </main>
  );
}

function StatusChip({ status }: { status: SourceStatus }) {
  const busy = status !== "ready" && status !== "error";
  return (
    <Chip size="sm" variant="soft" color={status === "error" ? "danger" : busy ? "default" : "success"}>
      {busy && <Spinner size="sm" color="current" className="size-3" />}
      <Chip.Label>{STATUS_LABEL[status]}</Chip.Label>
    </Chip>
  );
}

function SourcePanel({ sourceId, onDeleted }: { sourceId: string; onDeleted: () => void }) {
  const router = useRouter();
  const [detail, reload] = usePoll<SourceDetail>(`/api/sources/${sourceId}`, 2000);
  const [creating, setCreating] = useState<string | null>(null);

  const cancelJob = async (jobId: string) => {
    const res = await fetch(`/api/jobs/${jobId}/cancel`, { method: "POST" });
    if (!res.ok && res.status !== 409) toast.danger("Arrêt impossible", { description: await res.text() });
    reload();
  };

  const saveCreator = async (creator: string) => {
    if (creator.trim() === (detail?.creator ?? "")) return;
    const res = await fetch(`/api/sources/${sourceId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ creator: creator.trim() || null }),
    });
    if (!res.ok) toast.danger("Enregistrement impossible", { description: await res.text() });
    else reload();
  };

  const findMomentsAgain = async () => {
    const res = await fetch(`/api/sources/${sourceId}/moments`, { method: "POST" });
    if (!res.ok) toast.danger("Impossible de relancer", { description: await res.text() });
    else toast.success("Recherche des moments relancée");
    reload();
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

  if (!detail) {
    return (
      <div className="flex justify-center py-4">
        <Spinner size="sm" />
      </div>
    );
  }
  const { activeJob } = detail;

  return (
    <div className="flex flex-col gap-4">
      {detail.error && (
        <p className="rounded-xl bg-danger-soft p-3 font-mono text-xs text-danger-soft-foreground">{detail.error}</p>
      )}

      {activeJob && (
        <div className="flex items-end gap-3">
          <ProgressBar aria-label={activeJob.type} size="sm" value={activeJob.progress * 100} className="flex-1">
            <Label className="text-xs text-muted">{STATUS_LABEL[detail.status] ?? activeJob.type}</Label>
            <ProgressBar.Output className="text-xs tabular-nums" />
            <ProgressBar.Track>
              <ProgressBar.Fill />
            </ProgressBar.Track>
          </ProgressBar>
          <Button size="sm" variant="ghost" onPress={() => cancelJob(activeJob.id)}>
            <StopFill />
            Arrêter
          </Button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Input
          key={detail.creator ?? ""}
          variant="secondary"
          defaultValue={detail.creator ?? ""}
          placeholder="Nom du créateur (streamer, invité…)"
          aria-label="Nom du créateur, utilisé dans les titres"
          className="min-w-56 max-w-sm flex-1"
          onBlur={(e) => saveCreator(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        />
        <Button variant="tertiary" onPress={findMomentsAgain} isDisabled={!!activeJob || !detail.durationSec}>
          <ArrowsRotateRight />
          Retrouver les moments
        </Button>
      </div>

      {detail.moments.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2">
          {detail.moments.map((m) => (
            <li key={m.id} className="flex">
              <Card variant="secondary" className="flex-1">
                <Card.Header className="flex-row items-start justify-between gap-3">
                  <Card.Title className="text-sm leading-snug">{m.title ?? m.hook}</Card.Title>
                  <Tooltip delay={300}>
                    <Tooltip.Trigger aria-label="Score">
                      <Chip size="sm" variant="soft" className="tabular-nums">
                        <Chip.Label>{m.score}</Chip.Label>
                      </Chip>
                    </Tooltip.Trigger>
                    <Tooltip.Content>Score de viralité estimé</Tooltip.Content>
                  </Tooltip>
                </Card.Header>
                <Card.Content className="gap-1.5 text-sm">
                  {m.title && (
                    <p>
                      <span className="text-muted">Accroche · </span>
                      {m.hook}
                      {m.teaserStart != null && <span className="text-muted"> · ouverture teaser</span>}
                    </p>
                  )}
                  <p className="line-clamp-3 text-xs text-muted">{m.reason}</p>
                </Card.Content>
                <Card.Footer className="mt-auto items-center justify-between">
                  <span className="font-mono text-xs text-muted tabular-nums">
                    {formatTime(m.start, 0)} → {formatTime(m.end, 0)} · {Math.round(m.end - m.start)} s
                  </span>
                  <Button size="sm" onPress={() => createProject(m.id)} isDisabled={!!creating} isPending={creating === m.id}>
                    {({ isPending }) => (
                      <>
                        {isPending ? <Spinner size="sm" color="current" /> : <Scissors />}
                        Monter
                      </>
                    )}
                  </Button>
                </Card.Footer>
              </Card>
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
