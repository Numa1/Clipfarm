"use client";

import { useSyncExternalStore } from "react";

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

const TICK_MS = 30_000;
const subscribeTick = (cb: () => void) => {
  const t = setInterval(cb, TICK_MS);
  return () => clearInterval(t);
};

/** Current time rounded to 30 s, so relative times stay fresh between polls (0 on the server). */
export function useNow() {
  return useSyncExternalStore(
    subscribeTick,
    () => Math.floor(Date.now() / TICK_MS) * TICK_MS,
    () => 0,
  );
}
