"use client";

import { CircleDollar } from "@gravity-ui/icons";
import { Chip, Tooltip } from "@heroui/react";
import { formatTokens, formatUsd } from "@/lib/format";
import type { SourceCost } from "@/lib/cost";

/**
 * Estimated Claude cost. `share` = a montage's part of its video's analysis.
 * The price is the API equivalent: on a Claude subscription nothing is billed per call.
 */
export function CostChip({
  cost,
  share = false,
  weighted = false,
  showUnknown = false,
  size = "sm",
}: {
  cost: SourceCost | null;
  share?: boolean;
  /** When `share` is set, whether that share was computed pro rata (e.g. by word count) rather than
   *  split equally between the source's moments. Purely informational: only changes the tooltip wording. */
  weighted?: boolean;
  /** Videos analysed before cost tracking have no cost: hidden unless asked. */
  showUnknown?: boolean;
  size?: "sm" | "md";
}) {
  const unknown = cost?.calls === 0;
  if (!cost || (unknown && !showUnknown)) return null;
  return (
    <Tooltip delay={300}>
      <Tooltip.Trigger aria-label="Coût estimé">
        <Chip size={size} variant="soft" className="tabular-nums">
          <CircleDollar className="size-3 text-warning" aria-hidden />
          <Chip.Label>{unknown ? "Coût non suivi" : `≈ ${formatUsd(cost.costUsd)}`}</Chip.Label>
        </Chip>
      </Tooltip.Trigger>
      <Tooltip.Content className="max-w-64 text-xs">
        {unknown ? (
          <p>Analysée avant le suivi des coûts. Relance « Retrouver les moments » pour le mesurer.</p>
        ) : (
          <div className="flex flex-col gap-1">
            <p className="font-medium">
              {formatTokens(cost.tokens)} tokens{share ? " (part de l’analyse)" : ""} · {formatUsd(cost.costUsd)}
            </p>
            <p className="text-muted">
              {share
                ? weighted
                  ? "Une analyse trouve tous les moments d’une vidéo : son coût est réparti entre eux au prorata de leur durée de parole."
                  : "Une analyse trouve tous les moments d’une vidéo : son coût est réparti entre eux."
                : `${cost.calls} appel${cost.calls > 1 ? "s" : ""} à Claude pour l’analyse.`}{" "}
              Prix équivalent API, non facturé avec un abonnement. Transcription, recadrage et rendu tournent en local.
            </p>
          </div>
        )}
      </Tooltip.Content>
    </Tooltip>
  );
}
