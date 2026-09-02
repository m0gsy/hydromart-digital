'use client';

import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';

import { AccessDeniedHq } from '@/components/hq/access-denied';
import { HqBottomNav } from '@/components/hq/hq-bottom-nav';
import { HqRail } from '@/components/hq/hq-rail';
import { capForHqPath } from '@/lib/hq-nav';
import { RequireAuth } from '@/components/require-auth';
import { useAuth } from '@/lib/auth-context';
import { can, isHq } from '@/lib/roles';

// Audit F-9: the palette is mounted on every HQ screen but only renders once someone
// presses ⌘K. Loading it lazily keeps it out of the first paint of all 60 routes.
const CommandPalette = dynamic(
  () => import('@/components/hq/command-palette').then((m) => m.CommandPalette),
  { ssr: false },
);

// HQ console shell: a persistent left rail (network-wide, no depot switcher) under the
// app top nav, mirroring the ops dashboard layout. There is NO DepotProvider — HQ is
// network-scoped. The whole tree is gated to HEAD_OFFICE / SUPER_ADMIN (design 20c);
// /hq/login is the way in, so it renders bare (outside the auth + HQ gate).
/*
 * Two gates, not one.
 *
 * The console gate (`isHq`) says who may be in here at all. The second says who may be on
 * THIS screen, and it reads the capability off the same rail table that decides whether the
 * link is drawn — see `capForHqPath`. CA-2-60: 58 of 64 /hq pages carried no gate of their
 * own, so every one of them was reachable by typing its URL, whatever the rail showed. A
 * head-office account could open /hq/hierarchy, whose every request the server refuses, and
 * read the result as a broken page rather than as a door that was never theirs.
 */
function HqGate({ children }: { children: React.ReactNode }) {
  const { customer } = useAuth();
  const pathname = usePathname();
  const role = customer?.role;
  if (!isHq(role)) return <AccessDeniedHq role={role} />;
  const cap = capForHqPath(pathname);
  if (cap && !can(cap, role)) return <AccessDeniedHq role={role} />;
  return <>{children}</>;
}

export default function HqLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (pathname === '/hq/login') return <>{children}</>;

  return (
    <RequireAuth>
      <HqGate>
        <div className="flex">
          <HqRail />
          <div className="min-w-0 flex-1 px-4 pb-24 pt-6 sm:px-8 sm:pb-10">{children}</div>
        </div>
        <HqBottomNav />
        <CommandPalette />
      </HqGate>
    </RequireAuth>
  );
}
