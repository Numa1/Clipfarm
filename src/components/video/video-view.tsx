"use client";

import {
  ArrowsRotateRight,
  ChevronRight,
  CircleCheckFill,
  CircleExclamationFill,
  Scissors,
  StopFill,
  ThunderboltFill,
  TrashBin,
} from "@gravity-ui/icons";
import { EmptyState, TextShimmer } from "@heroui-pro/react";
import {
  AlertDialog,
  Button,
  Card,
  Chip,
  Input,
  Label,
  ProgressBar,
  Separator,
  Skeleton,
  Tabs,
  toast,
} from "@heroui/react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, type CSSProperties } from "react";
import { CostChip } from "@/components/media/cost-chip";
import { AnimatedNumber } from "@/components/library/animated-number";
import { MomentCard } from "@/components/library/moment-card";
import { STATUS_DETAIL, StatusChip } from "@/components/library/status-chip";
import { fetchJson, formatTime, formatTokens, formatUsd } from "@/lib/format";
import { useNow } from "@/lib/relative-time";
import { usePoll } from "@/lib/use-poll";
import { shareOf, type SourceCost } from "@/lib/cost";
import type { Job, Moment, Source } from "@/server/db/schema";
import { MontageCard, type MontageRow } from "./montage-card";

type SourceDetail = Source & {
  moments: Moment[];
  projects: MontageRow[];
  cost: SourceCost;
  activeJob: Job | null;
  lastJob: Job | null;
};

const STEP_LABEL: Partial<Record<Job["type"], string>> = {
  ingest: "La préparation de la vidéo",
  transcribe: "La transcription",
  moments: "La recherche des moments",
};

// Entrance stagger: CSS animations only run on mount, so polling re-renders never replay them.
const stagger = (i: number): CSSProperties => ({ animationDelay: `${Math.min(i, 6) * 40}ms` });

/** A source video as a project: its player, analysis cost, moments and the montages made from them. */
export function VideoView() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [detail, reload] = usePoll<SourceDetail>(`/api/sources/${id}`, 2000);
  const [tab, setTab] = useState<string>("moments");
  const [creating, setCreating] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  const [relaunching, setRelaunching] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const now = useNow();

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
    const res = await fetch(`/api/sources/${id}`, {
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
      const res = await fetch(`/api/sources/${id}/moments`, { method: "POST" });
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
      const { id: projectId } = await fetchJson<{ id: string }>("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ momentId }),
      });
      router.push(`/projects/${projectId}`);
    } catch (e) {
      toast.danger(String(e));
      setCreating(null);
    }
  };

  const deleteSource = async () => {
    await fetch(`/api/sources/${id}`, { method: "DELETE" });
    toast.success("Vidéo supprimée");
    router.push("/");
  };

  if (!detail) return <VideoSkeleton />;

  const { activeJob, lastJob } = detail;
  // The last step of the pipeline failed or was stopped (and nothing runs since): offer a retry.
  const failedJob = !activeJob && lastJob && (lastJob.status === "error" || lastJob.status === "cancelled") ? lastJob : null;
  const proxy = detail.proxyPath ? `/api/media/${detail.proxyPath}` : null;
  const montageByMoment = new Map(detail.projects.filter((p) => p.momentId).map((p) => [p.momentId!, p.id]));
  const montageCost = shareOf(detail.cost, detail.moments.length);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 pt-8 pb-16">
      <header className="flex animate-fade-in-up flex-col gap-4">
        <nav aria-label="Fil d’Ariane" className="flex items-center gap-1.5 text-sm text-muted">
          <Link href="/" className="transition-colors duration-150 hover:text-foreground">
            Vidéos
          </Link>
          <ChevronRight className="size-3 shrink-0" aria-hidden />
          <span className="min-w-0 truncate text-foreground">{detail.title}</span>
        </nav>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-balance">{detail.title}</h1>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
              <StatusChip status={detail.status} />
              {detail.durationSec ? <span className="font-mono tabular-nums">{formatTime(detail.durationSec, 0)}</span> : null}
              <span aria-hidden>·</span>
              <span className="tabular-nums">
                {detail.moments.length} {detail.moments.length > 1 ? "moments" : "moment"}
              </span>
              <span aria-hidden>·</span>
              <span className="tabular-nums">
                {detail.projects.length} {detail.projects.length > 1 ? "montages" : "montage"}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
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
            <AlertDialog>
              <Button isIconOnly variant="ghost" aria-label="Supprimer la vidéo" className="hover:text-danger">
                <TrashBin />
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
                        « {detail.title} », ses moments et tous ses fichiers seront supprimés. Les montages restent
                        mais perdent leur vidéo. Cette action est irréversible.
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
      </header>

      {failedJob ? (
        <div
          role="alert"
          className="flex animate-fade-in items-start gap-3 rounded-2xl bg-danger-soft p-4 text-danger-soft-foreground"
        >
          <CircleExclamationFill className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <p className="text-sm font-medium">
              {STEP_LABEL[failedJob.type] ?? "L’étape"} {failedJob.status === "cancelled" ? "a été arrêtée" : "a échoué"}
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
          <p className="flex animate-fade-in items-start gap-2 rounded-2xl bg-danger-soft p-4 font-mono text-xs text-danger-soft-foreground">
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
            <AnimatedNumber value={activeJob.progress * 100} suffix={" %"} className="ms-auto text-xs text-muted tabular-nums" />
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

      <div className="grid animate-fade-in-up gap-6 lg:grid-cols-[minmax(0,1fr)_320px]" style={stagger(1)}>
        <div className="overflow-hidden rounded-2xl bg-black ring-1 ring-white/10">
          {proxy ? (
            // Opens on a frame a tenth of the way in: the very first frame is often black.
            <video
              src={`${proxy}#t=${((detail.durationSec ?? 0) * 0.1).toFixed(1)}`}
              controls
              preload="metadata"
              className="aspect-video size-full bg-black"
            />
          ) : (
            <Skeleton className="aspect-video w-full rounded-none" />
          )}
        </div>

        <Card className="gap-5">
          <div className="flex flex-col gap-2">
            <Label className="text-xs font-medium text-muted">Créateur</Label>
            <div className="relative flex items-center">
              <Input
                key={detail.creator ?? ""}
                variant="secondary"
                defaultValue={detail.creator ?? ""}
                placeholder="Streamer, invité…"
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
            <p className="text-xs text-muted">Utilisé dans les titres des shorts.</p>
          </div>

          <Separator />

          <AnalysisCost cost={detail.cost} momentCount={detail.moments.length} />
        </Card>
      </div>

      <Tabs
        variant="secondary"
        selectedKey={tab}
        onSelectionChange={(k) => setTab(String(k))}
        className="animate-fade-in-up"
        style={stagger(2)}
      >
        <Tabs.ListContainer>
          <Tabs.List aria-label="Contenu de la vidéo">
            <Tabs.Tab id="moments">
              Moments
              <Chip size="sm" variant="soft" className="ms-1.5 tabular-nums">
                <Chip.Label>{detail.moments.length}</Chip.Label>
              </Chip>
              <Tabs.Indicator />
            </Tabs.Tab>
            <Tabs.Tab id="montages">
              Montages
              <Chip size="sm" variant="soft" className="ms-1.5 tabular-nums">
                <Chip.Label>{detail.projects.length}</Chip.Label>
              </Chip>
              <Tabs.Indicator />
            </Tabs.Tab>
          </Tabs.List>
        </Tabs.ListContainer>

        <Tabs.Panel id="moments" className="pt-6">
          {detail.moments.length === 0 ? (
            <EmptyState size="sm" className="animate-fade-in">
              <EmptyState.Header>
                <EmptyState.Media variant="icon">
                  <ThunderboltFill />
                </EmptyState.Media>
                <EmptyState.Title>{activeJob ? "Analyse en cours" : "Aucun moment"}</EmptyState.Title>
                <EmptyState.Description>
                  {activeJob
                    ? "Les meilleurs moments apparaîtront ici dès la fin de l’analyse."
                    : "Lance une recherche pour trouver les passages qui feront de bons shorts."}
                </EmptyState.Description>
              </EmptyState.Header>
            </EmptyState>
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {detail.moments.map((m, i) => (
                <li key={m.id} className="flex animate-fade-in-up" style={stagger(i)}>
                  <MomentCard
                    moment={m}
                    previewSrc={proxy}
                    montageId={montageByMoment.get(m.id)}
                    pending={creating === m.id}
                    disabled={!!creating}
                    onCreate={() => createProject(m.id)}
                  />
                </li>
              ))}
            </ul>
          )}
        </Tabs.Panel>

        <Tabs.Panel id="montages" className="pt-6">
          {detail.projects.length === 0 ? (
            <EmptyState size="sm" className="animate-fade-in">
              <EmptyState.Header>
                <EmptyState.Media variant="icon">
                  <Scissors />
                </EmptyState.Media>
                <EmptyState.Title>Aucun montage</EmptyState.Title>
                <EmptyState.Description>Choisis un moment et clique sur « Monter » pour créer ton premier short.</EmptyState.Description>
              </EmptyState.Header>
              {detail.moments.length > 0 && (
                <EmptyState.Content>
                  <Button variant="tertiary" onPress={() => setTab("moments")}>
                    Voir les moments
                  </Button>
                </EmptyState.Content>
              )}
            </EmptyState>
          ) : (
            <ul className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {detail.projects.map((p, i) => (
                <li key={p.id} className="animate-fade-in-up" style={stagger(i)}>
                  <MontageCard montage={p} proxy={proxy} cost={montageCost} now={now} />
                </li>
              ))}
            </ul>
          )}
        </Tabs.Panel>
      </Tabs>
    </div>
  );
}

/** The video's Claude bill: total of every analysis run, and what each short costs on average. */
function AnalysisCost({ cost, momentCount }: { cost: SourceCost; momentCount: number }) {
  if (!cost.calls) {
    return (
      <div className="flex flex-col gap-2">
        <Label className="text-xs font-medium text-muted">Coût de l’analyse</Label>
        <p className="text-sm text-muted">
          Non mesuré : cette vidéo a été analysée avant le suivi des coûts. Relance « Retrouver les moments » pour le
          connaître.
        </p>
      </div>
    );
  }
  const perShort = cost.costUsd / Math.max(1, momentCount);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-medium text-muted">Coût de l’analyse</Label>
        <CostChip cost={cost} />
      </div>
      <p className="flex items-baseline gap-1.5">
        <span className="text-3xl font-semibold tracking-tight tabular-nums">≈ {formatUsd(cost.costUsd)}</span>
        <span className="text-xs text-muted">équivalent API</span>
      </p>
      <dl className="grid grid-cols-2 gap-2 text-xs">
        <div className="flex flex-col gap-0.5 rounded-xl bg-surface-secondary p-2.5">
          <dt className="text-muted">Tokens</dt>
          <dd className="font-medium tabular-nums">{formatTokens(cost.tokens)}</dd>
        </div>
        <div className="flex flex-col gap-0.5 rounded-xl bg-surface-secondary p-2.5">
          <dt className="text-muted">Par short</dt>
          <dd className="font-medium tabular-nums">≈ {formatUsd(perShort)}</dd>
        </div>
      </dl>
      <p className="text-xs text-muted">
        {cost.calls} appel{cost.calls > 1 ? "s" : ""} à Claude. Non facturé avec un abonnement ; transcription,
        recadrage et rendu tournent en local.
      </p>
    </div>
  );
}

function VideoSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 pt-8 pb-16" aria-hidden>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-40 rounded-md" />
        <Skeleton className="h-7 w-2/3 rounded-lg" />
        <Skeleton className="h-5 w-64 rounded-md" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Skeleton className="aspect-video rounded-2xl" />
        <Skeleton className="h-72 rounded-3xl" />
      </div>
    </div>
  );
}
