"use client";

import { Ban, ArrowsRotateRight, Filmstrip, HandPointUp, MusicNote, Text, TrashBin } from "@gravity-ui/icons";
import { EmptyState, Segment } from "@heroui-pro/react";
import {
  Chip,
  cn,
  ColorSwatchPicker,
  Kbd,
  Label,
  Separator,
  Slider,
  Spinner,
  TextArea,
  ToggleButton,
  toast,
} from "@heroui/react";
import { useParams } from "next/navigation";
import type { ComponentType, ReactNode, SVGProps } from "react";
import { formatTime } from "@/lib/format";
import { applyCommand } from "@/timeline/commands";
import { cropAt, shotAt, withShotLayout } from "@/timeline/crop";
import { findItem, itemDuration, removeItem, updateItem } from "@/timeline/ops";
import { type AudioItem, type Item, type ShotLayout, shotLayouts, type TextItem, type VideoItem } from "@/timeline/schema";
import { IconAction } from "./icon-action";
import { useEditor } from "./store";

/** Continuous edit (slider drag, typing): one history entry per gesture. */
function live<T extends Item>(id: string, patch: Partial<Omit<T, "id" | "type">>) {
  const st = useEditor.getState();
  st.beginGesture();
  st.preview((base) => updateItem<T>(base, id, patch));
}
const commit = () => useEditor.getState().endGesture();

function Field({ label, aside, children }: { label: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs font-medium text-muted">{label}</Label>
        {aside}
      </div>
      {children}
    </div>
  );
}

function NumberSlider({
  label,
  display,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  display: string | number;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <Slider
      value={value}
      minValue={min}
      maxValue={max}
      step={step}
      onChange={(v) => onChange(Array.isArray(v) ? v[0] : v)}
      onChangeEnd={commit}
      className="group/slider"
    >
      <Label className="text-xs font-medium text-muted">{label}</Label>
      <Slider.Output className="origin-right text-xs tabular-nums opacity-70 transition-[opacity,transform] duration-150 ease-smooth group-has-[[data-dragging=true]]/slider:scale-105 group-has-[[data-dragging=true]]/slider:opacity-100">
        {display}
      </Slider.Output>
      <Slider.Track>
        <Slider.Fill />
        <Slider.Thumb />
      </Slider.Track>
    </Slider>
  );
}

type Shortcut = { keys: (KbdKey | string)[]; action: string };
type KbdKey = "command" | "shift" | "space" | "delete";
const ABBR = new Set<string>(["command", "shift", "space", "delete"]);

const SHORTCUTS: Shortcut[] = [
  { keys: ["Espace"], action: "Lecture / pause" },
  { keys: ["S"], action: "Couper à la tête de lecture" },
  { keys: ["delete"], action: "Supprimer la sélection" },
  { keys: ["command", "Z"], action: "Annuler" },
  { keys: ["shift", "command", "Z"], action: "Rétablir" },
  { keys: ["command", "Molette"], action: "Zoom de la timeline" },
];

function Keys({ keys }: { keys: Shortcut["keys"] }) {
  return (
    <Kbd className="text-[11px]">
      {keys.map((k) =>
        ABBR.has(k) ? <Kbd.Abbr key={k} keyValue={k as KbdKey} /> : <Kbd.Content key={k}>{k}</Kbd.Content>,
      )}
    </Kbd>
  );
}

type Icon = ComponentType<SVGProps<SVGSVGElement>>;
/** Same icons and hues as the timeline tracks. */
const ITEM_META: Record<Item["type"], { label: string; icon: Icon; tone: string }> = {
  video: { label: "Clip vidéo", icon: Filmstrip, tone: "bg-track-video/15 text-track-video" },
  text: { label: "Texte", icon: Text, tone: "bg-track-text/15 text-track-text" },
  audio: { label: "Son", icon: MusicNote, tone: "bg-track-audio/15 text-track-audio" },
  caption: { label: "Sous-titres", icon: Text, tone: "bg-track-text/15 text-track-text" },
};

function NoSelection() {
  return (
    <div className="flex animate-fade-in-up flex-col gap-6">
      <EmptyState size="sm" className="px-0">
        <EmptyState.Header>
          <EmptyState.Media variant="icon">
            <HandPointUp />
          </EmptyState.Media>
          <EmptyState.Title>Aucune sélection</EmptyState.Title>
          <EmptyState.Description>Clique un élément de la timeline pour régler son cadrage, son texte ou son volume.</EmptyState.Description>
        </EmptyState.Header>
      </EmptyState>
      <section className="flex flex-col gap-1">
        <h3 className="px-1 pb-1 text-xs font-medium text-muted">Raccourcis</h3>
        <dl className="flex flex-col">
          {SHORTCUTS.map(({ keys, action }, i) => (
            <div
              key={action}
              className="flex animate-fade-in-up items-center justify-between gap-3 rounded-md px-1 py-1.5 text-xs"
              style={{ animationDelay: `${80 + i * 30}ms` }}
            >
              <dt className="text-muted">{action}</dt>
              <dd>
                <Keys keys={keys} />
              </dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}

export function Inspector() {
  const selectedId = useEditor((s) => s.selectedId);
  const item = useEditor((s) => (s.selectedId && s.timeline ? findItem(s.timeline, s.selectedId)?.item : null));
  const meta = item ? ITEM_META[item.type] : null;

  return (
    <aside className="hidden w-72 shrink-0 flex-col overflow-y-auto border-l border-border p-4 lg:flex">
      {!item || !selectedId || !meta ? (
        <NoSelection />
      ) : (
        // Keyed by item: switching selection replays a short entrance instead of morphing fields in place.
        <div key={selectedId} className="flex animate-fade-in-up flex-col gap-6 [animation-duration:240ms]">
          <div className="flex items-center gap-3">
            <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg animate-scale-in", meta.tone)}>
              <meta.icon className="size-4" />
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <h3 className="text-sm font-semibold">{meta.label}</h3>
              <p className="flex items-center gap-1.5 text-xs text-muted">
                <span className="font-mono tabular-nums">{formatTime(item.start)}</span>
                <span aria-hidden className="text-muted/50">·</span>
                <span className="font-mono tabular-nums">{formatTime(itemDuration(item))}</span>
              </p>
            </div>
            <IconAction
              label="Supprimer"
              shortcut="Suppr"
              placement="left"
              className="hover:text-danger"
              onPress={() => {
                const st = useEditor.getState();
                st.apply((tl) => removeItem(tl, item.id));
                st.select(null);
              }}
            >
              <TrashBin />
            </IconAction>
          </div>
          <Separator />
          {item.type === "video" && <VideoFields item={item} />}
          {item.type === "audio" && <AudioFields item={item} />}
          {item.type === "text" && <TextFields item={item} />}
        </div>
      )}
    </aside>
  );
}

const LAYOUT_LABELS: Record<ShotLayout, string> = {
  crop: "Recadré",
  split: "Partagé",
  fit: "Plein cadre",
};

const LAYOUT_HINTS: Record<ShotLayout, string> = {
  crop: "Suit le visage du locuteur.",
  split: "Facecam en haut, contenu en bas.",
  fit: "Image entière sur fond flouté.",
};

function VideoFields({ item }: { item: VideoItem }) {
  const { id: projectId } = useParams<{ id: string }>();
  const reframing = useEditor((s) => !!s.reframeJobId);
  // Start of the shot under the playhead (source time, clamped to the clip). Selecting it rather than
  // the playhead re-renders the inspector when the shot changes, not on every played frame.
  const sourceTime = useEditor((s) =>
    shotAt(item.crop, Math.min(item.sourceOut, Math.max(item.sourceIn, item.sourceIn + s.playhead - item.start))).t,
  );
  const shot = shotAt(item.crop, sourceTime);
  const shots = item.crop.mode === "auto" ? (item.crop.shots ?? []) : [];

  // Manual framing edits a single static keyframe, seeded from the current auto/center framing.
  const current = cropAt(item.crop, item.sourceIn);
  const setManual = (patch: Partial<{ x: number; zoom: number }>) =>
    live<VideoItem>(item.id, {
      crop: { mode: "manual", keyframes: [{ ...current, t: item.sourceIn, ...patch }] },
    });

  /** Recompute this clip only: back to auto locally (so the result merges in), save, queue the job. */
  const recompute = async () => {
    const st = useEditor.getState();
    st.apply((tl) => applyCommand(tl, { type: "setCrop", itemId: item.id, crop: { mode: "auto", keyframes: [] } }));
    await fetch(`/api/projects/${projectId}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ timeline: useEditor.getState().timeline }),
    });
    const r = await fetch(`/api/projects/${projectId}/reframe`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ itemIds: [item.id] }),
    });
    if (r.ok) st.setReframeJob(((await r.json()) as { id: string }).id);
    else toast.danger("Recadrage impossible", { description: await r.text() });
  };

  return (
    <>
      <NumberSlider
        label="Volume"
        display={`${Math.round(item.volume * 100)} %`}
        value={item.volume}
        min={0}
        max={2}
        step={0.05}
        onChange={(volume) => live<VideoItem>(item.id, { volume })}
      />
      <Field
        label="Cadrage 9:16"
        aside={
          item.crop.mode === "auto" && (
            <IconAction label="Recalculer le cadrage" onPress={() => void recompute()} isDisabled={reframing}>
              {reframing ? <Spinner size="sm" color="current" /> : <ArrowsRotateRight />}
            </IconAction>
          )
        }
      >
        <Segment
          size="sm"
          aria-label="Cadrage 9:16"
          selectedKey={item.crop.mode}
          isDisabled={reframing}
          onSelectionChange={(key) => {
            if (key === item.crop.mode) return;
            if (key === "auto") void recompute();
            if (key === "center") useEditor.getState().apply((tl) => updateItem<VideoItem>(tl, item.id, { crop: { mode: "center", keyframes: [] } }));
            if (key === "manual") {
              setManual({});
              commit();
            }
          }}
        >
          <Segment.Item id="auto">Auto</Segment.Item>
          <Segment.Item id="center">Centre</Segment.Item>
          <Segment.Item id="manual">Manuel</Segment.Item>
        </Segment>
      </Field>
      {item.crop.mode === "auto" && (
        <Field
          label="Plan sous la tête de lecture"
          aside={
            shots.length ? (
              <Chip size="sm" variant="soft" className="tabular-nums">
                <Chip.Label>
                  Plan {shots.indexOf(shot) + 1} / {shots.length}
                </Chip.Label>
              </Chip>
            ) : undefined
          }
        >
          <Segment
            size="sm"
            aria-label="Mise en page du plan"
            selectedKey={shot.layout}
            isDisabled={reframing}
            onSelectionChange={(key) =>
              useEditor
                .getState()
                .apply((tl) => updateItem<VideoItem>(tl, item.id, { crop: withShotLayout(item.crop, sourceTime, key as ShotLayout) }))
            }
          >
            {shotLayouts.map((layout) => (
              <Segment.Item key={layout} id={layout}>
                {LAYOUT_LABELS[layout]}
              </Segment.Item>
            ))}
          </Segment>
          <p key={shot.layout} className="animate-fade-in text-xs text-muted">
            {LAYOUT_HINTS[shot.layout]}
          </p>
        </Field>
      )}
      {item.crop.mode === "manual" && (
        <>
          <NumberSlider
            label="Position horizontale"
            display={`${Math.round(current.x * 100)} %`}
            value={current.x}
            min={0}
            max={1}
            step={0.005}
            onChange={(x) => setManual({ x })}
          />
          <NumberSlider
            label="Zoom"
            display={`${current.zoom.toFixed(2)}×`}
            value={current.zoom}
            min={1}
            max={3}
            step={0.01}
            onChange={(zoom) => setManual({ zoom })}
          />
        </>
      )}
    </>
  );
}

function AudioFields({ item }: { item: AudioItem }) {
  return (
    <NumberSlider
      label="Volume"
      display={`${Math.round(item.volume * 100)} %`}
      value={item.volume}
      min={0}
      max={2}
      step={0.05}
      onChange={(volume) => live<AudioItem>(item.id, { volume })}
    />
  );
}

const COLORS = ["#ffffff", "#000000", "#facc15", "#22d3ee", "#f43f5e"];
/** Matches no swatch: how the pickers show "nothing selected". */
const NO_COLOR = "#00000000";

function Swatches({ label, value, onChange }: { label: string; value: string | null; onChange: (c: string) => void }) {
  return (
    <ColorSwatchPicker
      aria-label={label}
      size="sm"
      value={value ?? NO_COLOR}
      onChange={(c) => onChange(c.toString("hex").toLowerCase())}
    >
      {COLORS.map((c) => (
        <ColorSwatchPicker.Item key={c} color={c}>
          <ColorSwatchPicker.Swatch />
          <ColorSwatchPicker.Indicator />
        </ColorSwatchPicker.Item>
      ))}
    </ColorSwatchPicker>
  );
}

function TextFields({ item }: { item: TextItem }) {
  const style = (patch: Partial<TextItem["style"]>) => live<TextItem>(item.id, { style: { ...item.style, ...patch } });
  const pick = (patch: Partial<TextItem["style"]>) => {
    style(patch);
    commit();
  };
  return (
    <>
      <Field label="Texte">
        <TextArea
          aria-label="Texte"
          variant="secondary"
          fullWidth
          rows={3}
          value={item.text}
          onChange={(e) => live<TextItem>(item.id, { text: e.target.value })}
          onBlur={commit}
          className="resize-none"
        />
      </Field>
      <NumberSlider
        label="Taille"
        display={item.style.fontSize}
        value={item.style.fontSize}
        min={32}
        max={160}
        step={1}
        onChange={(fontSize) => style({ fontSize })}
      />
      <NumberSlider
        label="Position verticale"
        display={`${Math.round(item.y * 100)} %`}
        value={item.y}
        min={0.05}
        max={0.95}
        step={0.005}
        onChange={(y) => live<TextItem>(item.id, { y })}
      />
      <Field label="Couleur">
        <Swatches label="Couleur du texte" value={item.style.color} onChange={(color) => pick({ color })} />
      </Field>
      <Field label="Fond">
        <div className="flex items-center gap-2">
          <Swatches label="Couleur du fond" value={item.style.background} onChange={(background) => pick({ background })} />
          <ToggleButton
            isIconOnly
            size="sm"
            aria-label="Sans fond"
            isSelected={item.style.background === null}
            onChange={() => pick({ background: null })}
          >
            <Ban />
          </ToggleButton>
        </div>
      </Field>
    </>
  );
}
