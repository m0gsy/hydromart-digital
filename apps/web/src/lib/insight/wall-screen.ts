'use client';

import { usePathname } from 'next/navigation';

import { useQueryParam } from '@/lib/use-query-param';

/** The two pages that render the insight dashboard. */
const INSIGHT_PATHS = ['/hq/dashboard', '/dashboard/insight'];

/**
 * True on the insight dashboard opened with `?tv=1`: the console frame (rail, tab bars, depot
 * switcher) steps aside so the screen holds nothing but the figures. Any other page ignores the
 * flag, so a stray `?tv=1` cannot hide the navigation anywhere else.
 */
export function useWallScreen(): boolean {
  const pathname = usePathname() ?? '';
  const tv = useQueryParam('tv');
  return tv === '1' && INSIGHT_PATHS.some((p) => pathname === p || pathname === `${p}/`);
}
