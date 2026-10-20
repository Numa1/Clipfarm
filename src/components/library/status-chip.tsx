"use client";

import {
  CircleCheckFill,
  CircleExclamationFill,
  Clock,
  Gear,
  Magnifier,
  Microphone,
} from "@gravity-ui/icons";
import { Chip } from "@heroui/react";
import type { ComponentType, SVGProps } from "react";
import type { SourceStatus } from "@/server/db/schema";

export const STATUS_LABEL: Record<SourceStatus, string> = {
  uploaded: "En attente",
  ingesting: "Préparation",
  transcribing: "Transcription",
  analyzing: "Analyse",
  ready: "Prêt",
  error: "Erreur",
};

/** Longer wording for the progress bar inside the open panel. */
export const STATUS_DETAIL: Record<SourceStatus, string> = {
  uploaded: "En attente de traitement",
  ingesting: "Préparation de la vidéo",
  transcribing: "Transcription de l’audio",
  analyzing: "Recherche des meilleurs moments",
  ready: "Prêt",
  error: "Erreur",
};

const STATUS_ICON: Record<SourceStatus, ComponentType<SVGProps<SVGSVGElement>>> = {
  uploaded: Clock,
  ingesting: Gear,
  transcribing: Microphone,
  analyzing: Magnifier,
  ready: CircleCheckFill,
  error: CircleExclamationFill,
};

export const isBusy = (status: SourceStatus) => status !== "ready" && status !== "error";

export function StatusChip({ status }: { status: SourceStatus }) {
  const busy = isBusy(status);
  const Icon = STATUS_ICON[status];
  return (
    <Chip
      size="sm"
      variant="soft"
      color={status === "error" ? "danger" : busy ? "default" : "success"}
      className="transition-colors duration-300 ease-smooth"
    >
      {/* Keyed so the icon and label re-enter when the status moves on, not on every poll. */}
      <span key={status} className="flex animate-scale-in">
        <Icon className={busy ? "size-3 animate-pulse" : "size-3"} aria-hidden />
      </span>
      <Chip.Label key={`${status}-label`} className="animate-fade-in">
        {STATUS_LABEL[status]}
      </Chip.Label>
    </Chip>
  );
}
