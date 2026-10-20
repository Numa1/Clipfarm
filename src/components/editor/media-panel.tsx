"use client";

import { ArrowUpFromLine, MusicNote, Plus, Text } from "@gravity-ui/icons";
import { ListView } from "@heroui-pro/react";
import { Button, Spinner, toast } from "@heroui/react";
import { nanoid } from "nanoid";
import { useCallback, useEffect, useRef, useState } from "react";
import { produce } from "immer";
import { fetchJson } from "@/lib/format";
import { addItem } from "@/timeline/ops";
import { IconAction } from "./icon-action";
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
      toast.danger(String(e));
    }
  };

  const upload = async (file: File) => {
    setBusy(true);
    try {
      await fetchJson("/api/sfx", { method: "POST", headers: { "x-filename": encodeURIComponent(file.name) }, body: file });
      reload();
    } catch (e) {
      toast.danger(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="hidden w-60 shrink-0 flex-col gap-6 overflow-y-auto border-r border-border p-3 md:flex">
      <section className="flex flex-col gap-2">
        <h3 className="px-1 text-xs font-semibold text-muted">Texte</h3>
        <Button variant="tertiary" size="sm" fullWidth onPress={addText}>
          <Text />
          Ajouter un texte
        </Button>
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between px-1">
          <h3 className="text-xs font-semibold text-muted">Sons et musique</h3>
          <IconAction label="Importer un son" onPress={() => inputRef.current?.click()} isPending={busy}>
            {busy ? <Spinner size="sm" color="current" /> : <ArrowUpFromLine />}
          </IconAction>
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
        <ListView
          aria-label="Sons"
          variant="secondary"
          items={sfx}
          onAction={(key) => {
            const s = sfx.find((x) => x.src === key);
            if (s) void addSfx(s);
          }}
          renderEmptyState={() => (
            <p className="px-1 text-xs text-muted">Importe des sons (whoosh, pop, musique…) ou dépose-les dans library/sfx.</p>
          )}
        >
          {(s) => (
            <ListView.Item id={s.src} textValue={s.name}>
              <ListView.ItemContent>
                <MusicNote className="size-3.5 shrink-0 text-muted" />
                <ListView.Title className="text-xs font-normal">{s.name}</ListView.Title>
              </ListView.ItemContent>
              <ListView.ItemAction>
                <Plus className="size-3.5 text-muted" />
              </ListView.ItemAction>
            </ListView.Item>
          )}
        </ListView>
      </section>
    </aside>
  );
}
