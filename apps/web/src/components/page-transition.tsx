'use client';

import { usePathname } from 'next/navigation';

// Lightweight per-route enter animation. Keyed on pathname so each navigation
// re-mounts and fades up. No exit animation (App Router makes those brittle) — a
// clean mount fade is enough and can't trap scroll.
//
// Audit F-10: this was a framer-motion `motion.div` for a 250 ms opacity+translate.
// One CSS keyframe does the same thing and takes no runtime with it. Reduced motion
// is handled globally in globals.css.
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div key={pathname} style={{ animation: 'fadeUp 0.25s var(--ease-out) both' }}>
      {children}
    </div>
  );
}
