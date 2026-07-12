'use client';

/* Shared motion presets. All animation routes through Framer Motion, which
   respects the OS reduced-motion setting via `useReducedMotion` — we collapse
   variants to a no-op offset when it's on (the CSS guard in globals.css is the
   belt-and-suspenders backup for anything not using these). */
import { motion, useReducedMotion, type Variants } from 'framer-motion';
import type { ComponentProps, ReactNode } from 'react';

export const EASE_OUT = [0.2, 0.7, 0.2, 1] as const;

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: EASE_OUT } },
};

/* Parent that staggers its children (pair with `fadeUp` on each child). */
export const staggerParent: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06, delayChildren: 0.02 } },
};

/* Press feedback for tappable cards / tiles. */
export const pressable = {
  whileHover: { y: -3 },
  whileTap: { scale: 0.985 },
  transition: { duration: 0.18, ease: EASE_OUT },
} as const;

/* Section that fades its children up as it scrolls into view, once. */
export function MotionSection({
  children,
  className,
  ...rest
}: { children: ReactNode; className?: string } & ComponentProps<typeof motion.div>) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      variants={reduce ? undefined : staggerParent}
      initial={reduce ? undefined : 'hidden'}
      whileInView={reduce ? undefined : 'show'}
      viewport={{ once: true, amount: 0.15 }}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

/* A single item that fades up; use inside MotionSection or standalone. */
export function MotionItem({
  children,
  className,
  ...rest
}: { children: ReactNode; className?: string } & ComponentProps<typeof motion.div>) {
  const reduce = useReducedMotion();
  return (
    <motion.div className={className} variants={reduce ? undefined : fadeUp} {...rest}>
      {children}
    </motion.div>
  );
}
