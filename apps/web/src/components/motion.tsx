'use client';

import type { ComponentProps, CSSProperties, ReactNode } from 'react';

/* Audit F-10: this file used to pull in framer-motion (~110 KB) to run a 400 ms
   fade-and-rise and a hover lift. Both are CSS. The exported API is unchanged so the
   call sites did not move; what changed is that the shop no longer ships an animation
   runtime to draw them.

   Reduced motion is handled by the global rule in globals.css, which collapses every
   animation and transition to 0.01ms under `prefers-reduced-motion: reduce`. That is a
   media query, so it also applies before hydration — the old `useReducedMotion()` check
   could not. */

/** Per-child delay of the stagger, in ms. Matches the old staggerChildren: 0.06. */
const STAGGER_MS = 60;

type DivProps = ComponentProps<'div'>;

/* Section whose children fade up on mount, staggered by their index. */
export function MotionSection({
  children,
  className,
  ...rest
}: { children: ReactNode; className?: string } & DivProps) {
  return (
    <div className={className} {...rest}>
      {children}
    </div>
  );
}

/* A single item that fades up; pass `index` inside a MotionSection to stagger it. */
export function MotionItem({
  children,
  className,
  index = 0,
  style,
  ...rest
}: { children: ReactNode; className?: string; index?: number } & DivProps) {
  const staggered: CSSProperties = {
    ...style,
    animation: 'fadeUp 0.4s var(--ease-out) both',
    animationDelay: `${20 + index * STAGGER_MS}ms`,
  };
  return (
    <div className={className} style={staggered} {...rest}>
      {children}
    </div>
  );
}

/**
 * Press feedback for tappable cards / tiles. Spread onto a MotionItem — it is a
 * className now rather than framer props, so it composes with Tailwind as usual.
 */
export const pressable = {
  className:
    'transition-transform duration-[180ms] ease-[cubic-bezier(0.2,0.7,0.2,1)] hover:-translate-y-[3px] active:scale-[0.985]',
} as const;
