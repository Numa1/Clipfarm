"use client";

import { Button, Kbd, Tooltip, type ButtonProps } from "@heroui/react";

/** Icon-only ghost button with its label (and optional shortcut) in a tooltip. */
export function IconAction({
  label,
  shortcut,
  children,
  ...props
}: Omit<ButtonProps, "isIconOnly" | "aria-label"> & { label: string; shortcut?: string }) {
  return (
    <Tooltip delay={400} closeDelay={0}>
      <Button isIconOnly size="sm" variant="ghost" aria-label={label} {...props}>
        {children}
      </Button>
      <Tooltip.Content className="flex items-center gap-2">
        {label}
        {shortcut && (
          <Kbd variant="light">
            <Kbd.Content>{shortcut}</Kbd.Content>
          </Kbd>
        )}
      </Tooltip.Content>
    </Tooltip>
  );
}
