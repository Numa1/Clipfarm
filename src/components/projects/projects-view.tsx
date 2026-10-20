"use client";

import { ArrowDownToLine, ChevronRight, CircleCheckFill, Magnifier, Pencil, Scissors } from "@gravity-ui/icons";
import { EmptyState, ListView, Segment } from "@heroui-pro/react";
import { Button, buttonVariants, Chip, SearchField, Skeleton, Tooltip } from "@heroui/react";
import Link from "next/link";
import { useDeferredValue, useMemo, useState, useSyncExternalStore } from "react";
import { usePoll } from "@/lib/use-poll";
import { relativeTime, splitProjectName } from "./format";

type ProjectRow = { id: string; name: string; updatedAt: string; lastExportPath: string | null };
type Filter = "all" | "exported" | "draft";

const STAGGER_MS = 40;
const STAGGER_MAX = 6;

const TICK_MS = 30_000;
const subscribeTick = (cb: () => void) => {
  const t = setInterval(cb, TICK_MS);
  return () => clearInterval(t);
};

/** Current time rounded to 30 s, so relative times stay fresh between polls (0 on the server). */
function useNow() {
  return useSyncExternalStore(
    subscribeTick,
    () => Math.floor(Date.now() / TICK_MS) * TICK_MS,
    () => 0,
  );
}

function download(path: string) {
  const a = document.createElement("a");
  a.href = `/api/media/${path}`;
  a.download = "";
  a.click();
}

export function ProjectsView() {
  const [projects] = usePoll<ProjectRow[]>("/api/projects", 5000);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const deferredQuery = useDeferredValue(query);
  const now = useNow();

  const counts = useMemo(() => {
    const exported = projects?.filter((p) => p.lastExportPath).length ?? 0;
    return { all: projects?.length ?? 0, exported, draft: (projects?.length ?? 0) - exported };
  }, [projects]);

  const visible = useMemo(() => {
    const q = deferredQuery.trim().toLocaleLowerCase("fr");
    return (projects ?? []).filter(
      (p) =>
        (filter === "all" || (filter === "exported") === Boolean(p.lastExportPath)) &&
        (!q || p.name.toLocaleLowerCase("fr").includes(q)),
    );
  }, [projects, filter, deferredQuery]);

  const reset = () => {
    setQuery("");
    setFilter("all");
  };

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-6 pt-12 pb-16">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Projets</h1>
        <p className="text-sm text-muted">Les shorts en cours de montage.</p>
      </header>

      {projects === null ? (
        <ProjectsSkeleton />
      ) : projects.length === 0 ? (
        <EmptyState size="sm" className="animate-fade-in">
          <EmptyState.Header>
            <EmptyState.Media variant="icon">
              <Scissors />
            </EmptyState.Media>
            <EmptyState.Title>Aucun projet</EmptyState.Title>
            <EmptyState.Description>Monte un moment depuis la bibliothèque pour créer ton premier short.</EmptyState.Description>
          </EmptyState.Header>
          <EmptyState.Content>
            <Link href="/" className={buttonVariants({ variant: "primary", size: "sm" })}>
              Aller à la bibliothèque
            </Link>
          </EmptyState.Content>
        </EmptyState>
      ) : (
        <section className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <SearchField aria-label="Rechercher un projet" value={query} onChange={setQuery} className="w-full sm:max-w-xs">
              <SearchField.Group>
                <SearchField.SearchIcon />
                <SearchField.Input placeholder="Rechercher un projet…" />
                <SearchField.ClearButton />
              </SearchField.Group>
            </SearchField>
            <Segment
              size="sm"
              aria-label="Filtrer par statut"
              selectedKey={filter}
              onSelectionChange={(k) => setFilter(k as Filter)}
              className="self-start sm:self-auto"
            >
              <Segment.Item id="all">
                Tous <span className="text-muted tabular-nums">{counts.all}</span>
              </Segment.Item>
              <Segment.Item id="exported">
                Exportés <span className="text-muted tabular-nums">{counts.exported}</span>
              </Segment.Item>
              <Segment.Item id="draft">
                Brouillons <span className="text-muted tabular-nums">{counts.draft}</span>
              </Segment.Item>
            </Segment>
          </div>

          {visible.length === 0 ? (
            <EmptyState size="sm" className="animate-fade-in">
              <EmptyState.Header>
                <EmptyState.Media variant="icon">
                  <Magnifier />
                </EmptyState.Media>
                <EmptyState.Title>Aucun résultat</EmptyState.Title>
                <EmptyState.Description>
                  {deferredQuery.trim()
                    ? `Aucun projet ne correspond à « ${deferredQuery.trim()} ».`
                    : filter === "exported"
                      ? "Aucun projet exporté pour l’instant."
                      : "Aucun brouillon en cours."}
                </EmptyState.Description>
              </EmptyState.Header>
              <EmptyState.Content>
                <Button size="sm" variant="secondary" onPress={reset}>
                  Réinitialiser les filtres
                </Button>
              </EmptyState.Content>
            </EmptyState>
          ) : (
            // Keyed on the filter: switching segment replays the staggered entrance; polling keeps rows mounted.
            <ListView key={filter} aria-label="Projets" items={visible}>
              {(p) => {
                const { title, source } = splitProjectName(p.name);
                const index = visible.indexOf(p);
                const edited = `Modifié ${relativeTime(p.updatedAt, now)}`;
                return (
                  <ListView.Item
                    id={p.id}
                    textValue={p.name}
                    href={`/projects/${p.id}`}
                    className="group animate-fade-in-up transition-transform duration-150 ease-snappy data-[pressed=true]:scale-[0.995]"
                    style={{ animationDelay: `${Math.min(index, STAGGER_MAX) * STAGGER_MS}ms`, animationFillMode: "backwards" }}
                  >
                    <ListView.ItemContent>
                      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface-secondary">
                        <Scissors />
                      </span>
                      <div className="flex min-w-0 flex-col">
                        <ListView.Title title={p.name}>{title}</ListView.Title>
                        <ListView.Description className="tabular-nums">
                          {source ? `${source} · ${edited}` : edited}
                        </ListView.Description>
                      </div>
                    </ListView.ItemContent>
                    <ListView.ItemAction className="flex items-center gap-2">
                      {p.lastExportPath ? (
                        <Chip size="sm" variant="soft" color="success">
                          <CircleCheckFill />
                          <Chip.Label>Exporté</Chip.Label>
                        </Chip>
                      ) : (
                        <Chip size="sm" variant="soft">
                          <Pencil />
                          <Chip.Label>Brouillon</Chip.Label>
                        </Chip>
                      )}
                      {p.lastExportPath ? (
                        <Tooltip delay={400} closeDelay={0}>
                          <Button
                            isIconOnly
                            size="sm"
                            variant="ghost"
                            aria-label="Télécharger l’export"
                            onPress={() => download(p.lastExportPath!)}
                          >
                            <ArrowDownToLine />
                          </Button>
                          <Tooltip.Content>Télécharger l’export</Tooltip.Content>
                        </Tooltip>
                      ) : (
                        <span aria-hidden className="size-8" />
                      )}
                      <ChevronRight
                        aria-hidden
                        className="size-4 text-muted transition-transform duration-200 ease-smooth group-data-[hovered=true]:translate-x-0.5 group-data-[hovered=true]:text-foreground"
                      />
                    </ListView.ItemAction>
                  </ListView.Item>
                );
              }}
            </ListView>
          )}
        </section>
      )}
    </div>
  );
}

function ProjectsSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy aria-label="Chargement des projets">
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-9 w-full max-w-xs rounded-lg" />
        <Skeleton className="hidden h-7 w-64 rounded-lg sm:block" />
      </div>
      <div className="flex flex-col gap-px overflow-hidden rounded-[calc(var(--radius)*2.5)] bg-surface-secondary p-1">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex items-center gap-3 bg-surface px-4 py-3 first:rounded-t-[calc(var(--radius)*2)] last:rounded-b-[calc(var(--radius)*2)]">
            <Skeleton className="size-9 rounded-lg" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-3.5 w-2/5 rounded" />
              <Skeleton className="h-3 w-1/4 rounded" />
            </div>
            <Skeleton className="h-6 w-20 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
