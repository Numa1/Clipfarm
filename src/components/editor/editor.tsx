"use client";

import type { PlayerRef } from "@remotion/player";
import { ArrowDownToLine, ArrowLeft, ArrowUturnCcwLeft, ArrowUturnCwRight, StopFill } from "@gravity-ui/icons";
import { TextShimmer } from "@heroui-pro/react";
import { buttonVariants, Chip, Separator, Spinner, Toolbar, toast } from "@heroui/react";
import { AnimatePresence, motion, MotionConfig } from "motion/react";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { fetchJson } from "@/lib/format";
import type { Job, Project } from "@/server/db/schema";
import { mergeCrops } from "@/timeline/crop";
import { itemEnd, removeItem, splitItem } from "@/timeline/ops";
import { parseTimeline } from "@/timeline/schema";
import { ExportButton, ProjectTitle, SaveIndicator, type SaveStatus } from "./editor-chrome";
import { IconAction } from "./icon-action";
import { Inspector } from "./inspector";
import { MediaPanel } from "./media-panel";
import { Preview } from "./preview";
import { useEditor } from "./store";
import { TimelineView } from "./timeline-view";

type ProjectResponse = Project & { activeJobs: Job[] };

/** Toolbar controls that come and go (job chips, stop buttons, download link): a short pop, ease-snappy. */
const pop = {
  initial: { opacity: 0, scale: 0.9 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.9 },
  transition: { duration: 0.18, ease: [0.32, 0.72, 0, 1] as const },
};

export function Editor() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const playerRef = useRef<PlayerRef>(null);
  const [name, setName] = useState("");
  const [sourceId, setSourceId] = useState<string | null>(null);
  const reframeJobId = useEditor((s) => s.reframeJobId);
  const setReframeJob = useEditor((s) => s.setReframeJob);
  const reframing = !!reframeJobId;
  const [exportJob, setExportJob] = useState<Job | null>(null);
  // Latest startExport for the retry action of a failed-export toast (created inside a poll effect).
  const startExportRef = useRef(async () => {});
  const [lastExport, setLastExport] = useState<string | null>(null);
  const { timeline, load, undo, redo, canUndo, canRedo, revision } = useEditor(
    useShallow((s) => ({
      timeline: s.timeline,
      load: s.load,
      undo: s.undo,
      redo: s.redo,
      canUndo: s.past.length > 0,
      canRedo: s.future.length > 0,
      revision: s.revision,
    })),
  );
  // Presentation only: last revision the server acknowledged, and the export whose success was shown.
  const [saved, setSaved] = useState({ id, revision: 0, failed: false });
  const [ackedExportId, setAckedExportId] = useState<string | null>(null);

  // Initial load.
  useEffect(() => {
    fetchJson<ProjectResponse>(`/api/projects/${id}`)
      .then((p) => {
        load(parseTimeline(p.timeline));
        setName(p.name);
        setSourceId(p.sourceId);
        setLastExport(p.lastExportPath);
        setReframeJob(p.activeJobs.find((j) => j.type === "reframe")?.id ?? null);
      })
      .catch((e) => toast.danger(String(e)));
  }, [id, load, setReframeJob]);

  // While auto-reframe runs in the worker, poll its job, then merge its shots into the local timeline.
  useEffect(() => {
    if (!reframeJobId) return;
    const t = setInterval(async () => {
      const job = await fetchJson<Job>(`/api/jobs/${reframeJobId}`).catch(() => null);
      if (!job || job.status === "queued" || job.status === "running") return;
      if (job.status === "error") {
        setReframeJob(null);
        toast.danger("Recadrage auto échoué", {
          description: job.error ?? "Erreur inconnue",
          timeout: 0,
          actionProps: { children: "Réessayer", onPress: () => retryReframe(job.id) },
        });
        return;
      }
      if (job.status === "cancelled") {
        setReframeJob(null);
        toast.info("Recadrage auto arrêté");
        return;
      }
      const p = await fetchJson<ProjectResponse>(`/api/projects/${id}`);
      const remote = parseTimeline(p.timeline);
      // A history entry (undo reverts the framing explicitly) that also resumes autosave.
      useEditor.getState().apply((tl) => mergeCrops(tl, remote));
      setReframeJob(null);
      toast.success("Recadrage auto appliqué");
    }, 1500);
    return () => clearInterval(t);
  }, [id, reframeJobId, setReframeJob]);

  // Autosave (debounced) on every edit. Paused while the worker reframes: a save landing between
  // its write and our merge would erase the computed shots; pending edits are saved after the merge.
  useEffect(() => {
    if (!revision || !timeline || reframing) return;
    const t = setTimeout(() => {
      fetch(`/api/projects/${id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ timeline }),
      }).then(async (r) => {
        setSaved((s) => {
          const prev = s.id === id ? s.revision : 0;
          return { id, revision: r.ok ? Math.max(prev, revision) : prev, failed: !r.ok };
        });
        if (!r.ok) toast.danger("Sauvegarde refusée", { description: await r.text() });
      });
    }, 600);
    return () => clearTimeout(t);
  }, [id, revision, timeline, reframing]);

  // Export progress polling.
  useEffect(() => {
    if (!exportJob || (exportJob.status !== "queued" && exportJob.status !== "running")) return;
    const t = setInterval(async () => {
      const j = await fetchJson<Job>(`/api/jobs/${exportJob.id}`);
      setExportJob(j);
      if (j.status === "done") {
        setLastExport(String(j.result?.output));
        toast.success("Export terminé");
      } else if (j.status === "error") {
        toast.danger("Export échoué", {
          description: j.error ?? undefined,
          timeout: 0,
          // A fresh export (not a clone of the job): it renders the edits made since.
          actionProps: { children: "Réessayer", onPress: () => startExportRef.current() },
        });
      }
      else if (j.status === "cancelled") toast.info("Export arrêté");
    }, 1000);
    return () => clearInterval(t);
  }, [exportJob]);

  // Keep the "Exporté" confirmation on the button for a moment, then fall back to the label.
  const exportDone = exportJob?.status === "done" && ackedExportId !== exportJob.id;
  useEffect(() => {
    if (!exportDone || !exportJob) return;
    const t = setTimeout(() => setAckedExportId(exportJob.id), 1800);
    return () => clearTimeout(t);
  }, [exportDone, exportJob]);

  const startExport = async () => {
    // Flush pending changes first so the worker renders what's on screen.
    await fetch(`/api/projects/${id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ timeline: useEditor.getState().timeline }),
    });
    setExportJob(await fetchJson<Job>(`/api/projects/${id}/render`, { method: "POST" }));
  };

  useEffect(() => {
    startExportRef.current = startExport;
  });

  /** Stop a worker job; the polls above pick up the "cancelled" status and clean up. */
  const cancelJob = async (jobId: string) => {
    const res = await fetch(`/api/jobs/${jobId}/cancel`, { method: "POST" });
    if (!res.ok && res.status !== 409) toast.danger("Arrêt impossible", { description: await res.text() });
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
      const target = e.target;
      if (target instanceof Element && target.closest("input, textarea, [contenteditable=true]")) return;
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
      <div className="flex flex-1 animate-fade-in items-center justify-center [animation-delay:200ms]">
        <Spinner />
      </div>
    );
  }

  const exporting = exportJob && (exportJob.status === "queued" || exportJob.status === "running");
  const ack = saved.id === id ? saved : { revision: 0, failed: false };
  const saveStatus: SaveStatus = ack.failed ? "error" : revision > ack.revision ? "saving" : "saved";

  return (
    <MotionConfig reducedMotion="user">
      <div className="flex h-dvh flex-col overflow-hidden">
        <Toolbar aria-label="Projet" className="h-12 shrink-0 gap-2 rounded-none border-b border-border px-3">
          <IconAction
            label={sourceId ? "Retour à la vidéo" : "Bibliothèque"}
            onPress={() => router.push(sourceId ? `/videos/${sourceId}` : "/")}
          >
            <ArrowLeft />
          </IconAction>
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <ProjectTitle name={name} sourceId={sourceId} />
            {revision > 0 && <SaveIndicator status={saveStatus} />}
          </div>
          <AnimatePresence initial={false}>
            {reframing && (
              <motion.div key="reframe" className="flex items-center gap-1" {...pop}>
                <Chip size="sm" variant="soft">
                  <Spinner size="sm" color="current" className="size-3" />
                  <Chip.Label>
                    <TextShimmer>Recadrage auto…</TextShimmer>
                  </Chip.Label>
                </Chip>
                <IconAction label="Arrêter le recadrage auto" onPress={() => cancelJob(reframeJobId)}>
                  <StopFill />
                </IconAction>
              </motion.div>
            )}
          </AnimatePresence>
          <Separator orientation="vertical" className="h-5" />
          <IconAction label="Annuler" shortcut="⌘Z" onPress={undo} isDisabled={!canUndo}>
            <ArrowUturnCcwLeft />
          </IconAction>
          <IconAction label="Rétablir" shortcut="⇧⌘Z" onPress={redo} isDisabled={!canRedo}>
            <ArrowUturnCwRight />
          </IconAction>
          <Separator orientation="vertical" className="h-5" />
          <AnimatePresence initial={false} mode="popLayout">
            {lastExport && !exporting && (
              <motion.span key={lastExport} className="flex" {...pop}>
                <a
                  href={`/api/media/${lastExport}`}
                  download
                  title="Télécharger le dernier export"
                  className={buttonVariants({ variant: "tertiary", size: "sm" })}
                >
                  <ArrowDownToLine />
                  MP4
                </a>
              </motion.span>
            )}
            {exporting && (
              <motion.div key="stop-export" {...pop}>
                <IconAction label="Arrêter l’export" onPress={() => cancelJob(exportJob.id)}>
                  <StopFill />
                </IconAction>
              </motion.div>
            )}
          </AnimatePresence>
          <ExportButton
            state={exporting ? "exporting" : exportDone ? "done" : "idle"}
            progress={exportJob?.progress ?? 0}
            isDisabled={reframing}
            onPress={startExport}
          />
        </Toolbar>

        <div className="flex min-h-0 flex-1">
          <MediaPanel />
          <Preview ref={playerRef} />
          <Inspector />
        </div>

        <TimelineView playerRef={playerRef} onSplit={splitAtPlayhead} />
      </div>
    </MotionConfig>
  );
}
/** Queue a failed auto-reframe again; the editor polls the new job like the first one. */
async function retryReframe(jobId: string) {
  const res = await fetch(`/api/jobs/${jobId}/retry`, { method: "POST" });
  if (res.ok) useEditor.getState().setReframeJob(((await res.json()) as Job).id);
  else toast.danger("Impossible de relancer le recadrage", { description: await res.text() });
}
