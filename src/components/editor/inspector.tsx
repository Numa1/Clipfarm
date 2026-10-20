"use client";

import { Loader2Icon, ScanFaceIcon, Trash2Icon } from "lucide-react";
import { useParams } from "next/navigation";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { cropAt, shotAt, withShotLayout } from "@/timeline/crop";
import { findItem, itemDuration, removeItem, updateItem } from "@/timeline/ops";
import { type AudioItem, type Item, type ShotLayout, shotLayouts, type TextItem, type VideoItem } from "@/timeline/schema";
import { useEditor } from "./store";

/** Continuous edit (slider drag, typing): one history entry per gesture. */
function live<T extends Item>(id: string, patch: Partial<Omit<T, "id" | "type">>) {
  const st = useEditor.getState();
  st.beginGesture();
  st.preview((base) => updateItem<T>(base, id, patch));
}
const commit = () => useEditor.getState().endGesture();

function Field({ label, value, children }: { label: string; value?: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        {value !== undefined && <span className="tabular-nums">{value}</span>}
      </div>
      {children}
    </div>
  );
}

function NumberSlider({
  value,
  min,
  max,
  step,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <Slider
      value={[value]}
      min={min}
      max={max}
      step={step}
      onValueChange={(v) => onChange(Array.isArray(v) ? v[0] : v)}
      onValueCommitted={commit}
    />
  );
}

export function Inspector() {
  const selectedId = useEditor((s) => s.selectedId);
  const item = useEditor((s) => (s.selectedId && s.timeline ? findItem(s.timeline, s.selectedId)?.item : null));

  return (
    <aside className="hidden w-72 shrink-0 flex-col gap-5 overflow-y-auto border-l p-4 lg:flex">
      {!item || !selectedId ? (
        <div className="space-y-2 text-xs text-muted-foreground">
          <p>Sélectionne un élément de la timeline pour le modifier.</p>
          <ul className="space-y-1">
            <li>
              <kbd>Espace</kbd> lecture / pause
            </li>
            <li>
              <kbd>S</kbd> couper à la tête de lecture
            </li>
            <li>
              <kbd>Suppr</kbd> supprimer la sélection
            </li>
            <li>
              <kbd>⌘Z</kbd> / <kbd>⇧⌘Z</kbd> annuler / rétablir
            </li>
            <li>
              <kbd>⌘ + molette</kbd> zoom de la timeline
            </li>
          </ul>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">
              {item.type === "video" ? "Clip vidéo" : item.type === "audio" ? "Audio" : "Texte"}
            </h3>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Supprimer"
              onClick={() => {
                const st = useEditor.getState();
                st.apply((tl) => removeItem(tl, item.id));
                st.select(null);
              }}
            >
              <Trash2Icon />
            </Button>
          </div>
          <p className="-mt-3 text-xs tabular-nums text-muted-foreground">
            {formatTime(item.start)} · durée {formatTime(itemDuration(item))}
          </p>
          {item.type === "video" && <VideoFields item={item} />}
          {item.type === "audio" && <AudioFields item={item} />}
          {item.type === "text" && <TextFields item={item} />}
        </>
      )}
    </aside>
  );
}

const LAYOUT_LABELS: Record<ShotLayout, string> = {
  crop: "Recadré",
  split: "Écran partagé",
  fit: "Plein cadre",
};

function VideoFields({ item }: { item: VideoItem }) {
  const { id: projectId } = useParams<{ id: string }>();
  const reframing = useEditor((s) => s.reframing);
  const playhead = useEditor((s) => s.playhead);
  // Source time under the playhead, clamped to the clip.
  const sourceTime = Math.min(item.sourceOut, Math.max(item.sourceIn, item.sourceIn + playhead - item.start));
  const shot = shotAt(item.crop, sourceTime);
  const shots = item.crop.mode === "auto" ? (item.crop.shots ?? []) : [];

  // Manual framing edits a single static keyframe, seeded from the current auto/center framing.
  const current = cropAt(item.crop, item.sourceIn);
  const setManual = (patch: Partial<{ x: number; zoom: number }>) =>
    live<VideoItem>(item.id, {
      crop: { mode: "manual", keyframes: [{ ...current, t: item.sourceIn, ...patch }] },
    });

  const recompute = async () => {
    const st = useEditor.getState();
    // Manual clips are left alone by the worker: put this one back to auto first, then save.
    if (item.crop.mode === "manual") st.apply((tl) => updateItem<VideoItem>(tl, item.id, { crop: { mode: "auto", keyframes: [] } }));
    await fetch(`/api/projects/${projectId}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ timeline: useEditor.getState().timeline }),
    });
    const r = await fetch(`/api/projects/${projectId}/reframe`, { method: "POST" });
    if (r.ok) st.setReframing(true);
    else toast.error(`Recadrage impossible : ${await r.text()}`);
  };

  return (
    <>
      <Field label="Volume" value={`${Math.round(item.volume * 100)} %`}>
        <NumberSlider value={item.volume} min={0} max={2} step={0.05} onChange={(volume) => live<VideoItem>(item.id, { volume })} />
      </Field>
      <Field label="Cadrage 9:16">
        <div className="grid grid-cols-3 gap-1">
          {(["auto", "center", "manual"] as const).map((mode) => (
            <Button
              key={mode}
              size="xs"
              variant={item.crop.mode === mode ? "secondary" : "ghost"}
              disabled={reframing}
              onClick={() => {
                if (mode === "auto" && item.crop.mode !== "auto") void recompute();
                if (mode === "center") useEditor.getState().apply((tl) => updateItem<VideoItem>(tl, item.id, { crop: { mode: "center", keyframes: [] } }));
                if (mode === "manual") {
                  setManual({});
                  commit();
                }
              }}
            >
              {mode === "auto" ? "Auto" : mode === "center" ? "Centre" : "Manuel"}
            </Button>
          ))}
        </div>
        {item.crop.mode === "auto" && (
          <Button size="xs" variant="outline" className="w-full" onClick={() => void recompute()} disabled={reframing}>
            {reframing ? <Loader2Icon className="animate-spin" /> : <ScanFaceIcon />}
            {reframing ? "Analyse en cours…" : "Recalculer le cadrage"}
          </Button>
        )}
      </Field>
      {item.crop.mode === "auto" && (
        <Field label="Plan sous la tête de lecture" value={shots.length ? `${shots.indexOf(shot) + 1} / ${shots.length}` : undefined}>
          <div className="grid grid-cols-3 gap-1">
            {shotLayouts.map((layout) => (
              <Button
                key={layout}
                size="xs"
                variant={shot.layout === layout ? "secondary" : "ghost"}
                disabled={reframing}
                onClick={() =>
                  useEditor
                    .getState()
                    .apply((tl) => updateItem<VideoItem>(tl, item.id, { crop: withShotLayout(item.crop, sourceTime, layout) }))
                }
              >
                {LAYOUT_LABELS[layout]}
              </Button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Recadré : suit le visage · Écran partagé : facecam en haut, contenu en bas · Plein cadre : image entière sur fond
            flouté.
          </p>
        </Field>
      )}
      {item.crop.mode === "manual" && (
        <>
          <Field label="Position horizontale" value={`${Math.round(current.x * 100)} %`}>
            <NumberSlider value={current.x} min={0} max={1} step={0.005} onChange={(x) => setManual({ x })} />
          </Field>
          <Field label="Zoom" value={`${current.zoom.toFixed(2)}×`}>
            <NumberSlider value={current.zoom} min={1} max={3} step={0.01} onChange={(zoom) => setManual({ zoom })} />
          </Field>
        </>
      )}
    </>
  );
}

function AudioFields({ item }: { item: AudioItem }) {
  return (
    <Field label="Volume" value={`${Math.round(item.volume * 100)} %`}>
      <NumberSlider value={item.volume} min={0} max={2} step={0.05} onChange={(volume) => live<AudioItem>(item.id, { volume })} />
    </Field>
  );
}

const COLORS = ["#ffffff", "#000000", "#facc15", "#22d3ee", "#f43f5e"];

function TextFields({ item }: { item: TextItem }) {
  const style = (patch: Partial<TextItem["style"]>) => live<TextItem>(item.id, { style: { ...item.style, ...patch } });
  return (
    <>
      <Field label="Texte">
        <textarea
          value={item.text}
          rows={3}
          onChange={(e) => live<TextItem>(item.id, { text: e.target.value })}
          onBlur={commit}
          className="w-full resize-none rounded-lg border bg-transparent p-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        />
      </Field>
      <Field label="Taille" value={item.style.fontSize}>
        <NumberSlider value={item.style.fontSize} min={32} max={160} step={1} onChange={(fontSize) => style({ fontSize })} />
      </Field>
      <Field label="Position verticale" value={`${Math.round(item.y * 100)} %`}>
        <NumberSlider value={item.y} min={0.05} max={0.95} step={0.005} onChange={(y) => live<TextItem>(item.id, { y })} />
      </Field>
      <Field label="Couleur">
        <div className="flex gap-1.5">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={c}
              className={cn("size-6 rounded-full ring-1 ring-white/20", item.style.color === c && "ring-2 ring-white")}
              style={{ background: c }}
              onClick={() => {
                style({ color: c });
                commit();
              }}
            />
          ))}
        </div>
      </Field>
      <Field label="Fond">
        <div className="flex gap-1.5">
          {[null, ...COLORS].map((c) => (
            <button
              key={c ?? "none"}
              type="button"
              aria-label={c ?? "Aucun fond"}
              className={cn(
                "size-6 rounded-md ring-1 ring-white/20",
                item.style.background === c && "ring-2 ring-white",
                !c && "bg-[repeating-linear-gradient(45deg,transparent_0_4px,rgba(255,255,255,.25)_4px_6px)]",
              )}
              style={c ? { background: c } : undefined}
              onClick={() => {
                style({ background: c });
                commit();
              }}
            />
          ))}
        </div>
      </Field>
    </>
  );
}
