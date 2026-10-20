"use client";

import { Button, Kbd, Tooltip, type ButtonProps, type TooltipContentProps } from "@heroui/react";

/** Icon follows the press (on top of the button's own scale), eases back on release. */
const PRESS = "[&_svg]:transition-transform [&_svg]:duration-150 [&_svg]:ease-snappy data-[pressed=true]:[&_svg]:scale-90";

/** Icon-only ghost button with its label (and optional shortcut) in a tooltip. */
export function IconAction({
  label,
  shortcut,
  placement,
  className,
  children,
  ...props
}: Omit<ButtonProps, "isIconOnly" | "aria-label"> & {
  label: string;
  shortcut?: string;
  placement?: TooltipContentProps["placement"];
}) {
  return (
    // Moving along a toolbar swaps tooltips instantly instead of replaying the entrance each time.
    <Tooltip delay={400} closeDelay={0} shouldSkipAnimation>
      <Button
        isIconOnly
        size="sm"
        variant="ghost"
        aria-label={label}
        className={typeof className === "function" ? (rp) => `${PRESS} ${className(rp)}` : `${PRESS} ${className ?? ""}`}
        {...props}
      >
        {children}
      </Button>
      <Tooltip.Content placement={placement} offset={6} className="flex items-center gap-2 text-xs">
        {label}
        {shortcut && (
          <Kbd variant="light" className="text-[11px]">
            <Kbd.Content>{shortcut}</Kbd.Content>
          </Kbd>
        )}
      </Tooltip.Content>
    </Tooltip>
  );
}
