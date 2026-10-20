/**
 * Tarifs API (USD par million de tokens) par modèle, utilisés pour estimer le coût d'un appel
 * quand la CLI Claude ne rapporte pas elle-même "total_cost_usd" (voir src/server/llm.ts).
 * Source : tarification publique de l'API Anthropic, à mettre à jour si elle change.
 */
export type ModelPricing = {
  /** USD par million de tokens d'entrée (hors cache). */
  input: number;
  /** USD par million de tokens de sortie. */
  output: number;
  /** USD par million de tokens lus depuis le cache (moins cher qu'un token d'entrée classique). */
  cacheRead: number;
  /** USD par million de tokens écrits dans le cache (création d'une entrée). */
  cacheWrite: number;
};

export const MODEL_PRICING: Readonly<Record<string, ModelPricing>> = {
  "claude-opus-5-5": { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  "claude-sonnet-5": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  "claude-haiku-5": { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 },
};

/** Tarif utilisé pour un modèle absent de la table (garde l'estimation possible sans planter). */
export const DEFAULT_PRICING: ModelPricing = MODEL_PRICING["claude-sonnet-5"];

/** Tarif applicable à un modèle (ou le tarif par défaut si le modèle est inconnu ou absent). */
export function pricingFor(model: string | null | undefined): ModelPricing {
  if (!model) return DEFAULT_PRICING;
  return MODEL_PRICING[model] ?? DEFAULT_PRICING;
}

/** Coût estimé (USD) d'un appel à partir de ses tokens, selon le tarif du modèle. */
export function estimateCostUsd(
  model: string | null | undefined,
  tokens: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number },
): number {
  const p = pricingFor(model);
  return (
    (tokens.inputTokens * p.input +
      tokens.outputTokens * p.output +
      tokens.cacheReadTokens * p.cacheRead +
      tokens.cacheWriteTokens * p.cacheWrite) /
    1_000_000
  );
}
