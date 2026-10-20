/** Names are "<source> — <moment>" for hook-based projects; the moment reads first. */
export function splitProjectName(name: string): { title: string; source: string | null } {
  const i = name.indexOf(" — ");
  if (i <= 0) return { title: name, source: null };
  return { title: name.slice(i + 3), source: name.slice(0, i) };
}
