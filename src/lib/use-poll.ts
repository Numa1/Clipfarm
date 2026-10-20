"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchJson } from "@/lib/format";

/** Fetch `url` now and every `ms`; returns the latest payload and a manual reload. */
export function usePoll<T>(url: string, ms: number): [T | null, () => void] {
  const [data, setData] = useState<T | null>(null);
  const load = useCallback(() => {
    fetchJson<T>(url).then(setData).catch(() => {});
  }, [url]);
  useEffect(() => {
    load();
    const t = setInterval(load, ms);
    return () => clearInterval(t);
  }, [load, ms]);
  return [data, load];
}
