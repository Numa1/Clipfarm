"use client";

import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { useEffect } from "react";

/** Tweens between successive values instead of jumping (polled progress, upload %). */
export function AnimatedNumber({ value, suffix = "", className }: { value: number; suffix?: string; className?: string }) {
  const reduce = useReducedMotion();
  const mv = useMotionValue(value);
  const text = useTransform(mv, (v) => `${Math.round(v)}${suffix}`);

  useEffect(() => {
    const controls = animate(mv, value, { duration: reduce ? 0 : 0.6, ease: [0.22, 1, 0.36, 1] });
    return () => controls.stop();
  }, [mv, value, reduce]);

  return <motion.span className={className}>{text}</motion.span>;
}
