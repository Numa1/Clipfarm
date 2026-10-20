"use client";

import { Keyboard, LayoutSideContentLeft, Scissors, Video } from "@gravity-ui/icons";
import { NumberValue, Sidebar, useSidebar } from "@heroui-pro/react";
import { Card, Kbd, Spinner } from "@heroui/react";
import { LayoutGroup, motion } from "motion/react";
import { usePathname } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import type { Source, SourceStatus } from "@/server/db/schema";
import { Brand } from "./brand";

const STATUS_LABEL: Record<SourceStatus, string> = {
  uploaded: "En file",
  ingesting: "Préparation",
  transcribing: "Transcription",
  analyzing: "Analyse",
  ready: "Prêt",
  error: "Erreur",
};

export type SidebarPanelProps = {
  /** Distinct per instance (desktop rail / mobile sheet) so the active pill animates within its own tree. */
  id: "desktop" | "mobile";
  sourceCount?: number;
  projectCount?: number;
  processing: Source[];
  onShowShortcuts: () => void;
};

/** Header, navigation and footer — shared by the desktop sidebar and the mobile sheet. */
export function SidebarPanel(props: SidebarPanelProps) {
  // `usePathname` suspends on the editor route while prerendering; the fallback has no active item.
  return (
    <Suspense fallback={<PanelBody {...props} pathname={null} />}>
      <PanelWithPath {...props} />
    </Suspense>
  );
}

function PanelWithPath(props: SidebarPanelProps) {
  return <PanelBody {...props} pathname={usePathname()} />;
}

function PanelBody({
  id,
  pathname,
  sourceCount,
  projectCount,
  processing,
  onShowShortcuts,
}: SidebarPanelProps & { pathname: string | null }) {
  const { isOpen, toggleSidebar } = useSidebar();
  const desktop = id === "desktop";
  const onVideos = pathname === "/" || !!pathname?.startsWith("/videos/");
  const onProjects = pathname === "/projects" || !!pathname?.startsWith("/projects/");
  const live = processing.length > 0;

  return (
    <LayoutGroup id={id}>
      <Sidebar.Header className="animate-fade-in">
        <Brand />
      </Sidebar.Header>

      <Sidebar.Content className="animate-fade-in">
        <Sidebar.Group>
          <Sidebar.GroupLabel>Espace de travail</Sidebar.GroupLabel>
          <Sidebar.Menu aria-label="Navigation principale">
            <NavItem
              id="videos"
              href="/"
              label="Vidéos"
              tooltip={live ? `Vidéos · ${processing.length} en traitement` : "Vidéos"}
              icon={<Video />}
              count={sourceCount}
              isCurrent={onVideos}
              live={live}
            />
            <NavItem
              id="projects"
              href="/projects"
              label="Montages"
              icon={<Scissors />}
              count={projectCount}
              isCurrent={onProjects}
            />
          </Sidebar.Menu>
        </Sidebar.Group>
      </Sidebar.Content>

      <Sidebar.Footer className="animate-fade-in">
        {live && (!desktop || isOpen) && <ProcessingCard sources={processing} />}
        <Sidebar.Menu aria-label="Aide">
          <Sidebar.MenuItem id="shortcuts" textValue="Raccourcis" onAction={onShowShortcuts}>
            <Sidebar.MenuIcon>
              <Keyboard />
            </Sidebar.MenuIcon>
            <Sidebar.MenuLabel>Raccourcis</Sidebar.MenuLabel>
          </Sidebar.MenuItem>
          {desktop && (
            <Sidebar.MenuItem
              id="toggle"
              textValue={isOpen ? "Réduire le menu" : "Déplier le menu"}
              tooltip="Déplier le menu (⌘B)"
              onAction={toggleSidebar}
            >
              <Sidebar.MenuIcon>
                <LayoutSideContentLeft />
              </Sidebar.MenuIcon>
              <Sidebar.MenuLabel>{isOpen ? "Réduire le menu" : "Déplier le menu"}</Sidebar.MenuLabel>
              <Sidebar.MenuChip>
                <Kbd variant="light">
                  <Kbd.Content>⌘B</Kbd.Content>
                </Kbd>
              </Sidebar.MenuChip>
            </Sidebar.MenuItem>
          )}
        </Sidebar.Menu>
      </Sidebar.Footer>
    </LayoutGroup>
  );
}

function NavItem({
  id,
  href,
  label,
  tooltip,
  icon,
  count,
  isCurrent,
  live,
}: {
  id: string;
  href: string;
  label: string;
  tooltip?: string;
  icon: ReactNode;
  count?: number;
  isCurrent: boolean;
  live?: boolean;
}) {
  return (
    <Sidebar.MenuItem
      id={id}
      href={href}
      textValue={label}
      tooltip={tooltip ?? label}
      isCurrent={isCurrent}
      // The sliding pill replaces the built-in current background.
      className="isolate [&[data-current=true]_[data-slot=sidebar-menu-item-content]]:bg-transparent"
    >
      {isCurrent && (
        <motion.span
          layoutId="nav-active"
          aria-hidden
          className="absolute inset-0 -z-10 rounded-[calc(var(--radius)*2)] bg-default"
          transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
        />
      )}
      <Sidebar.MenuIcon className="relative">
        {icon}
        {live && (
          <span aria-hidden className="absolute -top-0.5 -right-0.5 size-1.5 animate-pulse rounded-full bg-accent" />
        )}
      </Sidebar.MenuIcon>
      <Sidebar.MenuLabel>
        {label}
        {live && <span className="sr-only"> (traitement en cours)</span>}
      </Sidebar.MenuLabel>
      {count !== undefined && (
        <Sidebar.MenuChip>
          {/* Re-keyed on change so a new count eases in. */}
          <span key={count} className="animate-fade-in-up">
            <NumberValue value={count} />
          </span>
        </Sidebar.MenuChip>
      )}
    </Sidebar.MenuItem>
  );
}

function ProcessingCard({ sources }: { sources: Source[] }) {
  const shown = sources.slice(0, 3);
  const rest = sources.length - shown.length;

  return (
    <Card className="mb-1 animate-fade-in-up gap-2.5 p-3" role="status" aria-live="polite">
      <div className="flex items-center gap-2 text-xs font-medium">
        <Spinner size="sm" color="current" className="size-3.5 text-muted" />
        <span className="flex-1">Traitement en cours</span>
        <span className="text-muted tabular-nums">{sources.length}</span>
      </div>
      <ul className="flex flex-col gap-1.5">
        {shown.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-2 text-xs">
            <span className="min-w-0 truncate">{s.title}</span>
            <span className="shrink-0 text-muted">{STATUS_LABEL[s.status]}</span>
          </li>
        ))}
      </ul>
      {rest > 0 && <p className="text-xs text-muted tabular-nums">et {rest} autre{rest > 1 ? "s" : ""}</p>}
    </Card>
  );
}
