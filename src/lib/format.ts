/** 75.3 → "1:15.3" (or "1:02:05" with hours). */
export function formatTime(sec: number, decimals = 1): string {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = s % 60;
  const ss = rest.toFixed(decimals).padStart(decimals ? 3 + decimals : 2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss.split(".")[0]}` : `${m}:${ss}`;
}

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

/** 0.6213 → "0,62 $", 0.0123 → "0,012 $" (API-equivalent price, in US dollars). */
export function formatUsd(usd: number): string {
  const digits = usd > 0 && usd < 0.1 ? 3 : 2;
  return `${usd.toLocaleString("fr-FR", { minimumFractionDigits: digits, maximumFractionDigits: digits })} $`;
}

/** 48213 → "48,2 k", 1_250_000 → "1,3 M". */
export function formatTokens(tokens: number): string {
  return new Intl.NumberFormat("fr-FR", { notation: "compact", maximumFractionDigits: 1 }).format(tokens);
}
