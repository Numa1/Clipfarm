"use client";

import { ArrowUpFromLine, MusicNote, PlayFill, Plus, StopFill, Text } from "@gravity-ui/icons";
import { EmptyState, ListView, TextShimmer } from "@heroui-pro/react";
import { Button, Chip, Spinner, toast } from "@heroui/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { produce } from "immer";
import { fetchJson } from "@/lib/format";
import { createAudioItem, createTextItem } from "@/timeline/factory";
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
  const [uploading, setUploading] = useState<string | null>(null);
  const busy = uploading !== null;
  const inputRef = useRef<HTMLInputElement>(null);
  // Audition a sound before dropping it on the timeline (one at a time).
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);

  const stopPreview = useCallback(() => {
    audioRef.current?.pause();
    audioRef.current = null;
    setPlaying(null);
  }, []);
  useEffect(() => () => audioRef.current?.pause(), []);

  const togglePreview = (s: Sfx) => {
    const was = playing;
    stopPreview();
    if (was === s.src) return;
    const a = new Audio(`/api/media/${s.src}`);
    a.volume = 0.8;
    a.onended = () => {
      if (audioRef.current === a) stopPreview();
    };
    audioRef.current = a;
    setPlaying(s.src);
    a.play().catch(() => stopPreview());
  };

  const reload = useCallback(() => {
    fetchJson<Sfx[]>("/api/sfx").then(setSfx).catch(() => {});
  }, []);
  useEffect(reload, [reload]);

  const addText = () => {
    const { apply, playhead, select } = useEditor.getState();
    const item = createTextItem({ start: playhead, text: "Ton texte" });
    apply((tl) => addItem(tl, item));
    select(item.id);
  };

  const addSfx = async (s: Sfx) => {
    try {
      const durationSec = await audioDuration(`/api/media/${s.src}`);
      const { apply, playhead, select } = useEditor.getState();
      const assetId = `sfx:${s.src}`;
      const item = createAudioItem({ start: playhead, assetId, sourceIn: 0, sourceOut: durationSec, volume: 0.8 });
      apply((tl) => {
        const withAsset = produce(tl, (d) => {
          d.assets[assetId] ??= { id: assetId, kind: "audio", src: s.src, durationSec };
        });
        return addItem(withAsset, item);
      });
      select(item.id);
    } catch (e) {
      toast.danger(String(e));
    }
  };

  const upload = async (file: File) => {
    setUploading(file.name.replace(/\.[^.]+$/, ""));
    try {
      await fetchJson("/api/sfx", { method: "POST", headers: { "x-filename": encodeURIComponent(file.name) }, body: file });
      reload();
    } catch (e) {
      toast.danger(String(e));
    } finally {
      setUploading(null);
    }
  };

  const pickFile = () => inputRef.current?.click();

  return (
    <aside className="hidden w-60 shrink-0 flex-col gap-6 overflow-y-auto border-r border-border p-3 md:flex">
      <section className="flex flex-col gap-2">
        <h3 className="px-1 text-xs font-medium text-muted">Texte</h3>
        <Button variant="tertiary" size="sm" fullWidth onPress={addText} className="group justify-start">
          <Text className="text-track-text" />
          Ajouter un texte
          <Plus className="ms-auto size-3.5 text-muted transition-transform duration-200 ease-smooth group-data-[hovered=true]:scale-110 group-data-[pressed=true]:scale-90" />
        </Button>
      </section>

      <section className="flex min-h-0 flex-col gap-2">
        <div className="flex items-center justify-between gap-2 px-1">
          <h3 className="flex items-center gap-2 text-xs font-medium text-muted">
            Sons et musique
            {sfx.length > 0 && (
              <Chip size="sm" variant="soft" className="h-4 min-w-4 animate-scale-in px-1 text-[10px] tabular-nums">
                <Chip.Label>{sfx.length}</Chip.Label>
              </Chip>
            )}
          </h3>
          <IconAction label="Importer un son" onPress={pickFile} isPending={busy}>
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
        {uploading && (
          <div className="flex animate-fade-in-up items-center gap-2 rounded-lg px-2 py-2 text-xs text-muted" role="status">
            <Spinner size="sm" color="current" className="size-3.5" />
            <TextShimmer className="min-w-0 truncate">{`Import de ${uploading}…`}</TextShimmer>
          </div>
        )}
        <ListView
          aria-label="Sons"
          variant="secondary"
          items={sfx}
          onAction={(key) => {
            const s = sfx.find((x) => x.src === key);
            if (s) void addSfx(s);
          }}
          renderEmptyState={() =>
            busy ? null : (
              <EmptyState size="sm" className="animate-fade-in px-0">
                <EmptyState.Header>
                  <EmptyState.Media variant="icon">
                    <MusicNote />
                  </EmptyState.Media>
                  <EmptyState.Title>Aucun son</EmptyState.Title>
                  <EmptyState.Description>
                    Whooshs, pops, musiques… Importe-les ici ou dépose-les dans library/sfx.
                  </EmptyState.Description>
                </EmptyState.Header>
                <EmptyState.Content>
                  <Button size="sm" variant="secondary" onPress={pickFile}>
                    <ArrowUpFromLine />
                    Importer un son
                  </Button>
                </EmptyState.Content>
              </EmptyState>
            )
          }
        >
          {(s) => {
            const isPlaying = playing === s.src;
            return (
              <ListView.Item
                id={s.src}
                textValue={s.name}
                className="group animate-fade-in-up"
                style={{ animationDelay: `${Math.min(sfx.indexOf(s), 8) * 30}ms` }}
              >
                <ListView.ItemContent>
                  <MusicNote
                    className={`size-3.5 shrink-0 ${isPlaying ? "text-track-audio" : "text-muted"}`}
                  />
                  <ListView.Title className="text-xs font-normal">{s.name}</ListView.Title>
                </ListView.ItemContent>
                <ListView.ItemAction className="flex items-center gap-0.5">
                  <IconAction
                    label={isPlaying ? "Arrêter l’écoute" : "Écouter"}
                    onPress={() => togglePreview(s)}
                    className={`size-6 min-w-6 transition-opacity duration-150 ease-smooth group-data-[hovered=true]:opacity-100 data-[focus-visible=true]:opacity-100 ${isPlaying ? "opacity-100" : "opacity-0"}`}
                  >
                    {isPlaying ? <StopFill className="size-3" /> : <PlayFill className="size-3" />}
                  </IconAction>
                  <Plus
                    aria-hidden
                    className="size-3.5 text-muted transition-transform duration-200 ease-smooth group-data-[hovered=true]:translate-x-0.5 group-data-[hovered=true]:scale-110 group-data-[pressed=true]:scale-90"
                  />
                </ListView.ItemAction>
              </ListView.Item>
            );
          }}
        </ListView>
      </section>
    </aside>
  );
}
