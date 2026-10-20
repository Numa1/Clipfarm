"use client";

import { ChevronRightIcon, FilmIcon, Loader2Icon, ScissorsIcon, Trash2Icon, UploadIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fetchJson, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Job, Moment, Source, SourceStatus } from "@/server/db/schema";

type SourceRow = Source & { momentCount: number };
type SourceDetail = Source & { moments: Moment[]; activeJob: Job | null };
type ProjectRow = { id: string; name: string; updatedAt: string; lastExportPath: string | null };

const STATUS_LABEL: Record<SourceStatus, string> = {
  uploaded: "En file",
  ingesting: "Préparation",
  transcribing: "Transcription",
  analyzing: "Recherche des moments",
  ready: "Prêt",
  error: "Erreur",
};

function usePoll<T>(url: string, ms: number): [T | null, () => void] {
  const [data, setData] = useState<T | null>(null);
  const load = useCallback(() => {
    fetchJson<T>(url).then(setData).catch(() => {});
  }, [url]);
  useEffect(() => {
    load();
    const t = setInterval(load, ms);
    return () => clearInterval(t);
  }, [load, ms]);
  return [data, load];
}

export function LibraryView() {
  const [sources, reloadSources] = usePoll<SourceRow[]>("/api/sources", 2000);
  const [projects] = usePoll<ProjectRow[]>("/api/projects", 5000);
  const [openId, setOpenId] = useState<string | null>(null);
  const [upload, setUpload] = useState<{ name: string; progress: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // XHR rather than fetch: we want upload progress on multi-GB files.
  const uploadFile = (file: File) => {
    setUpload({ name: file.name, progress: 0 });
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/sources");
    xhr.setRequestHeader("x-filename", encodeURIComponent(file.name));
    xhr.upload.onprogress = (e) => e.lengthComputable && setUpload({ name: file.name, progress: e.loaded / e.total });
    xhr.onload = () => {
      setUpload(null);
      if (xhr.status >= 300) toast.error(`Upload échoué : ${xhr.responseText}`);
      else {
        toast.success(`${file.name} importé, traitement en cours`);
        reloadSources();
      }
    };
    xhr.onerror = () => {
      setUpload(null);
      toast.error("Upload échoué");
    };
    xhr.send(file);
  };

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6">
      <header className="mb-8 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Clipfarm</h1>
          <p className="text-sm text-muted-foreground">Vidéos longues → shorts 9:16 en quelques minutes.</p>
        </div>
      </header>

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files[0];
          if (file) uploadFile(file);
        }}
        disabled={!!upload}
        className={cn(
          "flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-10 text-sm text-muted-foreground transition-colors",
          dragging ? "border-foreground/60 bg-muted/40" : "hover:border-foreground/30 hover:bg-muted/20",
        )}
      >
        {upload ? (
          <>
            <Loader2Icon className="size-5 animate-spin" />
            <span>
              {upload.name} — {Math.round(upload.progress * 100)} %
            </span>
            <div className="h-1 w-64 overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-foreground transition-all" style={{ width: `${upload.progress * 100}%` }} />
            </div>
          </>
        ) : (
          <>
            <UploadIcon className="size-5" />
            <span>Glisse une vidéo longue ici (podcast, interview, stream) ou clique pour choisir</span>
          </>
        )}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) uploadFile(file);
          e.target.value = "";
        }}
      />

      <section className="mt-10">
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">Bibliothèque</h2>
        {sources?.length === 0 && <p className="text-sm text-muted-foreground">Aucune vidéo pour l’instant.</p>}
        <ul className="divide-y rounded-xl border">
          {sources?.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/30"
                onClick={() => setOpenId(openId === s.id ? null : s.id)}
              >
                <ChevronRightIcon className={cn("size-4 shrink-0 transition-transform", openId === s.id && "rotate-90")} />
                <FilmIcon className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate font-medium">{s.title}</span>
                {s.durationSec ? (
                  <span className="text-xs tabular-nums text-muted-foreground">{formatTime(s.durationSec, 0)}</span>
                ) : null}
                <StatusBadge status={s.status} />
                {s.status === "ready" && <span className="text-xs text-muted-foreground">{s.momentCount} moments</span>}
              </button>
              {openId === s.id && <SourcePanel sourceId={s.id} onDeleted={reloadSources} />}
            </li>
          ))}
        </ul>
      </section>

      {!!projects?.length && (
        <section className="mt-10">
          <h2 className="mb-3 text-sm font-medium text-muted-foreground">Projets</h2>
          <ul className="divide-y rounded-xl border">
            {projects.map((p) => (
              <li key={p.id}>
                <a href={`/projects/${p.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30">
                  <ScissorsIcon className="size-4 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  {p.lastExportPath && <Badge variant="secondary">Exporté</Badge>}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

function StatusBadge({ status }: { status: SourceStatus }) {
  const busy = status !== "ready" && status !== "error";
  return (
    <Badge variant={status === "error" ? "destructive" : busy ? "outline" : "secondary"} className="gap-1">
      {busy && <Loader2Icon className="size-3 animate-spin" />}
      {STATUS_LABEL[status]}
    </Badge>
  );
}

function SourcePanel({ sourceId, onDeleted }: { sourceId: string; onDeleted: () => void }) {
  const router = useRouter();
  const [detail] = usePoll<SourceDetail>(`/api/sources/${sourceId}`, 2000);
  const [creating, setCreating] = useState<string | null>(null);

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
      toast.error(String(e));
      setCreating(null);
    }
  };

  if (!detail) return <div className="px-11 pb-4 text-sm text-muted-foreground">Chargement…</div>;

  return (
    <div className="space-y-3 px-4 pb-4 sm:pl-11">
      {detail.error && <p className="rounded-lg bg-destructive/10 p-3 font-mono text-xs text-destructive">{detail.error}</p>}
      {detail.activeJob && (
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>{detail.activeJob.type}</span>
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-foreground transition-all" style={{ width: `${detail.activeJob.progress * 100}%` }} />
          </div>
          <span className="tabular-nums">{Math.round(detail.activeJob.progress * 100)} %</span>
        </div>
      )}
      {detail.moments.length > 0 && (
        <ul className="grid gap-2 sm:grid-cols-2">
          {detail.moments.map((m) => (
            <li key={m.id} className="flex flex-col gap-2 rounded-lg border p-3">
              <div className="flex items-start justify-between gap-2">
                <p className="font-medium leading-snug">{m.hook}</p>
                <Badge variant="secondary" className="tabular-nums">
                  {m.score}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">{m.reason}</p>
              <div className="mt-auto flex items-center justify-between pt-1">
                <span className="text-xs tabular-nums text-muted-foreground">
                  {formatTime(m.start, 0)} → {formatTime(m.end, 0)} · {Math.round(m.end - m.start)} s
                </span>
                <Button size="sm" onClick={() => createProject(m.id)} disabled={!!creating}>
                  {creating === m.id ? <Loader2Icon className="animate-spin" /> : <ScissorsIcon />}
                  Monter
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="flex justify-end">
        <Button
          variant="ghost"
          size="sm"
          onClick={async () => {
            if (!confirm(`Supprimer « ${detail.title} » et tous ses fichiers ?`)) return;
            await fetch(`/api/sources/${sourceId}`, { method: "DELETE" });
            onDeleted();
          }}
        >
          <Trash2Icon />
          Supprimer
        </Button>
      </div>
    </div>
  );
}
