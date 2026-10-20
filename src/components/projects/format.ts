const rtf = new Intl.RelativeTimeFormat("fr", { numeric: "auto", style: "short" });

const STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 86_400_000],
  ["month", 30 * 86_400_000],
  ["week", 7 * 86_400_000],
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
];

/** "à l'instant", "il y a 5 min", "hier"… */
export function relativeTime(date: string | number | Date, now: number): string {
  const diff = new Date(date).getTime() - now;
  for (const [unit, ms] of STEPS) {
    if (Math.abs(diff) >= ms) return rtf.format(Math.round(diff / ms), unit);
  }
  return "à l'instant";
}

/** Names are "<source> — <moment>" for hook-based projects; the moment reads first. */
export function splitProjectName(name: string): { title: string; source: string | null } {
  const i = name.indexOf(" — ");
  if (i <= 0) return { title: name, source: null };
  return { title: name.slice(i + 3), source: name.slice(0, i) };
}
