import { Filmstrip } from "@gravity-ui/icons";

/** Logo tile + wordmark. The wordmark carries `data-sidebar="label"` so it fades out with the rail. */
export function Brand() {
  return (
    <div className="flex items-center gap-2.5 px-1">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
        <Filmstrip className="size-4" />
      </span>
      <span data-sidebar="label" className="text-sm font-semibold tracking-tight">
        Clipfarm
      </span>
    </div>
  );
}
