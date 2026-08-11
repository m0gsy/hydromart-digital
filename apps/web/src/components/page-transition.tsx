'use client';

import { useRef } from 'react';
import { usePathname } from 'next/navigation';

import { screenChrome } from '@/lib/screen-chrome';

// Lightweight per-route enter animation. Keyed on pathname so each navigation
// re-mounts and animates in. No exit animation (App Router makes those brittle) — a
// clean mount is enough and can't trap scroll.
//
// Audit F-10: this was a framer-motion `motion.div` for a 250 ms opacity+translate.
// One CSS keyframe does the same thing and takes no runtime with it. Reduced motion
// is handled globally in globals.css.

export type PageAnimation = 'fadeUp' | 'slideInRight' | 'slideInLeft';

/**
 * Which direction this navigation travelled, as far as the IA can tell.
 *
 * Only root↔pushed is answerable. Going from a tab into a screen pushed off it is
 * forward, coming back out is backward, and those two are worth animating because they
 * are the two the back chevron and the tab bar disagree about — the motion says which
 * one just happened.
 *
 * Everything else is `fadeUp`, deliberately. Pushed→pushed has no direction available
 * without reading history (`/orders/detail` → `/orders/detail/review` is forward,
 * the reverse is not, and the pathnames alone cannot tell them apart), and guessing
 * would animate backwards half the time. A first paint has no previous screen at all.
 */
export function pageAnimation(from: string | null, to: string): PageAnimation {
  if (from === null || from === to) return 'fadeUp';
  const before = screenChrome(from).kind;
  const after = screenChrome(to).kind;
  if (before === 'root' && after === 'pushed') return 'slideInRight';
  if (before === 'pushed' && after === 'root') return 'slideInLeft';
  return 'fadeUp';
}

export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // The screen this one replaced. A ref rather than state: it must not itself cause a
  // render, and it is read during the render that already knows the new pathname.
  const previous = useRef<string | null>(null);
  const animation = pageAnimation(previous.current, pathname);
  previous.current = pathname;

  return (
    <div key={pathname} style={{ animation: `${animation} 0.25s var(--ease-out) both` }}>
      {children}
    </div>
  );
}
