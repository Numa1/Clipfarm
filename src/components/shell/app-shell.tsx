"use client";

import { Bars } from "@gravity-ui/icons";
import { Sidebar } from "@heroui-pro/react";
import { MotionConfig } from "motion/react";
import { usePathname, useRouter } from "next/navigation";
import { Suspense, useLayoutEffect, useState, type ReactNode } from "react";
import { usePoll } from "@/lib/use-poll";
import type { Source } from "@/server/db/schema";
import { Brand } from "./brand";
import { ShortcutsDialog } from "./shortcuts-dialog";
import { SidebarPanel } from "./sidebar-panel";

/** App chrome: collapsible sidebar (icon rail on desktop, sheet on mobile) next to the page. */
export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [inEditor, setInEditor] = useState(false);

  // The editor needs the room: it gets its own open state, collapsed by default,
  // so leaving it restores whatever the user had chosen elsewhere.
  const [open, setOpen] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  const [sources] = usePoll<Source[]>("/api/sources", 3000);
  const [projects] = usePoll<{ id: string }[]>("/api/projects", 5000);
  const processing = sources?.filter((s) => s.status !== "ready" && s.status !== "error") ?? [];

  const panel = {
    sourceCount: sources?.length,
    projectCount: projects?.length,
    processing,
    onShowShortcuts: () => setShortcutsOpen(true),
  };

  return (
    <MotionConfig reducedMotion="user">
      <Sidebar.Provider
        open={inEditor ? editorOpen : open}
        onOpenChange={inEditor ? setEditorOpen : setOpen}
        navigate={(href) => router.push(href)}
        className="flex-1"
      >
        <Suspense fallback={null}>
          <EditorRouteSync onChange={setInEditor} />
        </Suspense>
        <Sidebar>
          <SidebarPanel id="desktop" {...panel} />
          <Sidebar.Rail aria-label="Afficher / masquer le menu" />
        </Sidebar>
        <Sidebar.Mobile>
          <SidebarPanel id="mobile" {...panel} />
        </Sidebar.Mobile>

        <Sidebar.Main>
          {!inEditor && (
            <header className="sticky top-0 z-30 flex h-12 shrink-0 items-center gap-1 border-b border-separator bg-background/80 px-2 backdrop-blur min-[769px]:hidden">
              <Sidebar.Trigger aria-label="Ouvrir le menu">
                <Bars className="size-4" />
              </Sidebar.Trigger>
              <Brand />
            </header>
          )}
          {children}
        </Sidebar.Main>
      </Sidebar.Provider>
      <ShortcutsDialog isOpen={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </MotionConfig>
  );
}

/**
 * The editor route has an unknown dynamic param, so `usePathname` suspends while prerendering
 * (cacheComponents). Reading it here, behind Suspense, keeps the rest of the shell static.
 */
function EditorRouteSync({ onChange }: { onChange: (inEditor: boolean) => void }) {
  const inEditor = usePathname().startsWith("/projects/");
  useLayoutEffect(() => onChange(inEditor), [inEditor, onChange]);
  return null;
}
