"use client";

import { Scissors } from "@gravity-ui/icons";
import { EmptyState, ListView } from "@heroui-pro/react";
import { Chip } from "@heroui/react";
import { usePoll } from "@/lib/use-poll";

type ProjectRow = { id: string; name: string; updatedAt: string; lastExportPath: string | null };

export function ProjectsView() {
  const [projects] = usePoll<ProjectRow[]>("/api/projects", 5000);

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-10 px-6 pt-12 pb-16">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Projets</h1>
        <p className="text-sm text-muted">Les shorts en cours de montage.</p>
      </header>

      {projects?.length === 0 ? (
        <EmptyState size="sm">
          <EmptyState.Header>
            <EmptyState.Media variant="icon">
              <Scissors />
            </EmptyState.Media>
            <EmptyState.Title>Aucun projet</EmptyState.Title>
            <EmptyState.Description>Monte un moment depuis la bibliothèque pour créer un projet.</EmptyState.Description>
          </EmptyState.Header>
        </EmptyState>
      ) : (
        <ListView aria-label="Projets" items={projects ?? []}>
          {(p) => (
            <ListView.Item id={p.id} textValue={p.name} href={`/projects/${p.id}`}>
              <ListView.ItemContent>
                <Scissors className="size-4 shrink-0 text-muted" />
                <ListView.Title>{p.name}</ListView.Title>
              </ListView.ItemContent>
              {p.lastExportPath && (
                <ListView.ItemAction>
                  <Chip size="sm" variant="soft" color="success">
                    <Chip.Label>Exporté</Chip.Label>
                  </Chip>
                </ListView.ItemAction>
              )}
            </ListView.Item>
          )}
        </ListView>
      )}
    </main>
  );
}
