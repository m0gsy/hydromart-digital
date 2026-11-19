'use client';

import { useRouter } from 'next/navigation';
import { usePathname } from 'next/navigation';

import { parentOf } from '@/lib/screen-chrome';
import { useQueryParam } from '@/lib/use-query-param';

/**
 * Mobile rule B (flow plan): an in-page back that never strands the reader. With history it
 * goes back; without — the screen was opened from a push or a shared link, as the first entry
 * — it goes to the screen's parent, where a plain `router.back()` did nothing or left the app.
 * A delivery's sub-screen keeps its delivery (`?id=`).
 */
export function useBack(): () => void {
  const router = useRouter();
  const pathname = usePathname();
  const id = useQueryParam('id');
  return () => {
    if (typeof window !== 'undefined' && window.history.length > 1) router.back();
    else router.replace(parentOf(pathname ?? '/', id || null));
  };
}
