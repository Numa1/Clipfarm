"use client";

import type { PlayerRef } from "@remotion/player";
import { ArrowLeftIcon, DownloadIcon, Loader2Icon, Redo2Icon, Undo2Icon } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { fetchJson } from "@/lib/format";
import type { Job, Project } from "@/server/db/schema";
import { itemEnd, removeItem, splitItem } from "@/timeline/ops";
import { parseTimeline, type Timeline } from "@/timeline/schema";
import { Inspector } from "./inspector";
import { MediaPanel } from "./media-panel";
import { Preview } from "./preview";
import { useEditor } from "./store";
import { TimelineView } from "./timeline-view";

type ProjectResponse = Project & { activeJobs: Job[] };

export function Editor() {
  const { id } = useParams<{ id: string }>();
  const playerRef = useRef<PlayerRef>(null);
  const [name, setName] = useState("");
  const [reframing, setReframing] = useState(false);
  const [exportJob, setExportJob] = useState<Job | null>(null);
  const [lastExport, setLastExport] = useState<string | null>(null);
  const { timeline, load, undo, redo, past, future, revision } = useEditor();

  // Initial load.
  useEffect(() => {
    fetchJson<ProjectResponse>(`/api/projects/${id}`)
      .then((p) => {
        load(parseTimeline(p.timeline));
        setName(p.name);
        setLastExport(p.lastExportPath);
        setReframing(p.activeJobs.some((j) => j.type === "reframe"));
      })
      .catch((e) => toast.error(String(e)));
  }, [id, load]);

  // While auto-reframe runs in the worker, poll and merge its crops into the local timeline.
  useEffect(() => {
    if (!reframing) return;
    const t = setInterval(async () => {
      const p = await fetchJson<ProjectResponse>(`/api/projects/${id}`);
      if (p.activeJobs.some((j) => j.type === "reframe")) return;
      setReframing(false);
      const remote = parseTimeline(p.timeline);
      useEditor.getState().replaceSilently((tl) => mergeCrops(tl, remote));
      toast.success("Recadrage auto appliqué");
    }, 1500);
    return () => clearInterval(t);
  }, [id, reframing]);

  // Autosave (debounced) on every edit.
  useEffect(() => {
    if (!revision || !timeline) return;
    const t = setTimeout(() => {
      fetch(`/api/projects/${id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ timeline }),
      }).then(async (r) => {
        if (!r.ok) toast.error(`Sauvegarde refusée : ${await r.text()}`);
      });
    }, 600);
    return () => clearTimeout(t);
  }, [id, revision, timeline]);

  // Export progress polling.
  useEffect(() => {
    if (!exportJob || exportJob.status === "done" || exportJob.status === "error") return;
    const t = setInterval(async () => {
      const j = await fetchJson<Job>(`/api/jobs/${exportJob.id}`);
      setExportJob(j);
      if (j.status === "done") {
        setLastExport(String(j.result?.output));
        toast.success("Export terminé");
      } else if (j.status === "error") toast.error(`Export échoué : ${j.error}`);
    }, 1000);
    return () => clearInterval(t);
  }, [exportJob]);

  const startExport = async () => {
    // Flush pending changes first so the worker renders what's on screen.
    await fetch(`/api/projects/${id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ timeline: useEditor.getState().timeline }),
    });
    setExportJob(await fetchJson<Job>(`/api/projects/${id}/render`, { method: "POST" }));
  };

  const splitAtPlayhead = useCallback(() => {
    const { timeline: tl, selectedId, playhead, apply } = useEditor.getState();
    if (!tl) return;
    // Selected item if any, otherwise every video clip under the playhead.
    const targets = selectedId
      ? [selectedId]
      : tl.tracks
          .filter((t) => t.kind === "video")
          .flatMap((t) => t.items)
          .filter((i) => i.start < playhead && itemEnd(i) > playhead)
          .map((i) => i.id);
    apply((t) => targets.reduce((acc, itemId) => splitItem(acc, itemId, playhead), t));
  }, []);

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, [contenteditable=true]")) return;
      const mod = e.metaKey || e.ctrlKey;
      if (e.code === "Space") {
        e.preventDefault();
        playerRef.current?.toggle();
      } else if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (e.key.toLowerCase() === "s" && !mod) {
        splitAtPlayhead();
      } else if (e.key === "Backspace" || e.key === "Delete") {
        const { selectedId, apply, select } = useEditor.getState();
        if (selectedId) {
          apply((t) => removeItem(t, selectedId));
          select(null);
        }
      } else if (e.key === "Escape") {
        useEditor.getState().select(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, splitAtPlayhead]);

  if (!timeline) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        <Loader2Icon className="size-5 animate-spin" />
      </div>
    );
  }

  const exporting = exportJob && (exportJob.status === "queued" || exportJob.status === "running");

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
        <Button variant="ghost" size="icon-sm" render={<Link href="/" />} nativeButton={false} aria-label="Retour">
          <ArrowLeftIcon />
        </Button>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{name}</span>
        {reframing && (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2Icon className="size-3 animate-spin" /> Recadrage auto…
          </span>
        )}
        <Button variant="ghost" size="icon-sm" onClick={undo} disabled={!past.length} aria-label="Annuler">
          <Undo2Icon />
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={redo} disabled={!future.length} aria-label="Rétablir">
          <Redo2Icon />
        </Button>
        {lastExport && !exporting && (
          <Button variant="outline" size="sm" render={<a href={`/api/media/${lastExport}`} download />} nativeButton={false}>
            <DownloadIcon /> MP4
          </Button>
        )}
        <Button size="sm" onClick={startExport} disabled={!!exporting}>
          {exporting ? (
            <>
              <Loader2Icon className="animate-spin" /> {Math.round((exportJob?.progress ?? 0) * 100)} %
            </>
          ) : (
            "Exporter"
          )}
        </Button>
      </header>

      <div className="flex min-h-0 flex-1">
        <MediaPanel />
        <Preview ref={playerRef} />
        <Inspector />
      </div>

      <TimelineView playerRef={playerRef} onSplit={splitAtPlayhead} />
    </div>
  );
}

/** Take crops computed by the worker for clips that still exist locally and weren't set manually. */
function mergeCrops(local: Timeline, remote: Timeline): Timeline {
  const crops = new Map(
    remote.tracks.flatMap((t) => t.items).flatMap((i) => (i.type === "video" ? [[i.id, i.crop] as const] : [])),
  );
  return {
    ...local,
    tracks: local.tracks.map((t) => ({
      ...t,
      items: t.items.map((i) =>
        i.type === "video" && i.crop.mode !== "manual" && crops.get(i.id)?.mode === "auto"
          ? { ...i, crop: crops.get(i.id)! }
          : i,
      ),
    })),
  };
}
