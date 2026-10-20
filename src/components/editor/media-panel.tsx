"use client";

import { Loader2Icon, MusicIcon, PlusIcon, TypeIcon, UploadIcon } from "lucide-react";
import { nanoid } from "nanoid";
import { useCallback, useEffect, useRef, useState } from "react";
import { produce } from "immer";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { fetchJson } from "@/lib/format";
import { addItem } from "@/timeline/ops";
import { useEditor } from "./store";

type Sfx = { name: string; src: string };

/** Read an audio file's duration in the browser (no server-side probe needed). */
function audioDuration(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const a = new Audio();
    a.preload = "metadata";
    a.onloadedmetadata = () => resolve(a.duration);
    a.onerror = () => reject(new Error("audio illisible"));
    a.src = url;
  });
}

export function MediaPanel() {
  const [sfx, setSfx] = useState<Sfx[]>([]);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(() => {
    fetchJson<Sfx[]>("/api/sfx").then(setSfx).catch(() => {});
  }, []);
  useEffect(reload, [reload]);

  const addText = () => {
    const { apply, playhead, select } = useEditor.getState();
    const id = nanoid(8);
    apply((tl) =>
      addItem(tl, {
        id,
        type: "text",
        start: playhead,
        duration: 3,
        text: "Ton texte",
        x: 0.5,
        y: 0.18,
        maxWidth: 0.86,
        style: { fontSize: 72, fontWeight: 800, color: "#ffffff", background: null, align: "center" },
      }),
    );
    select(id);
  };

  const addSfx = async (s: Sfx) => {
    try {
      const durationSec = await audioDuration(`/api/media/${s.src}`);
      const { apply, playhead, select } = useEditor.getState();
      const assetId = `sfx:${s.src}`;
      const id = nanoid(8);
      apply((tl) => {
        const withAsset = produce(tl, (d) => {
          d.assets[assetId] ??= { id: assetId, kind: "audio", src: s.src, durationSec };
        });
        return addItem(withAsset, {
          id,
          type: "audio",
          start: playhead,
          assetId,
          sourceIn: 0,
          sourceOut: durationSec,
          volume: 0.8,
        });
      });
      select(id);
    } catch (e) {
      toast.error(String(e));
    }
  };

  const upload = async (file: File) => {
    setBusy(true);
    try {
      await fetchJson("/api/sfx", { method: "POST", headers: { "x-filename": encodeURIComponent(file.name) }, body: file });
      reload();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="hidden w-60 shrink-0 flex-col gap-4 overflow-y-auto border-r p-3 md:flex">
      <section>
        <h3 className="mb-2 text-xs font-medium text-muted-foreground">Texte</h3>
        <Button variant="outline" size="sm" className="w-full justify-start" onClick={addText}>
          <TypeIcon /> Ajouter un texte
        </Button>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-medium text-muted-foreground">SFX / Musique</h3>
          <Button variant="ghost" size="icon-xs" onClick={() => inputRef.current?.click()} aria-label="Importer un son">
            {busy ? <Loader2Icon className="animate-spin" /> : <UploadIcon />}
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept="audio/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) upload(f);
              e.target.value = "";
            }}
          />
        </div>
        {sfx.length === 0 ? (
          <p className="text-xs text-muted-foreground">Importe des sons (whoosh, pop, musique…) ou dépose-les dans library/sfx.</p>
        ) : (
          <ul className="space-y-1">
            {sfx.map((s) => (
              <li key={s.src}>
                <button
                  type="button"
                  onClick={() => addSfx(s)}
                  className="group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted"
                >
                  <MusicIcon className="size-3.5 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{s.name}</span>
                  <PlusIcon className="size-3.5 opacity-0 group-hover:opacity-100" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </aside>
  );
}
