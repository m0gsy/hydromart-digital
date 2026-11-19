'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import {
  Buildings,
  ChartLineUp,
  ClipboardText,
  DotsThreeOutline,
  Package,
  Tag,
  TrendUp,
  type Icon,
} from '@phosphor-icons/react';

import { ConsoleSignOut } from '@/components/console-sign-out';

import { DepotSwitcher } from '@/components/dashboard/ops-rail';
import { GROUPS, hubsFor } from '@/lib/ops-nav';
import { Sheet } from '@/components/overlay';
import { useAuth } from '@/lib/auth-context';
import { useT } from '@/lib/locale-context';
import { deepest, normalisePath } from '@/lib/screen-chrome';
import {
  can,
  canManagePricing,
  canViewDashboard,
  canViewForecast,
  canViewFranchise,
  canViewInventory,
  isStaff,
} from '@/lib/roles';

type Role = string | null | undefined;
interface Tab {
  href: string;
  label: string;
  icon: Icon;
  show: (r: Role) => boolean;
}

// Mobile ops tab bar (design 5k-5p). The desktop left rail is lg-only, so on
// small screens this carries dashboard navigation. Role-filtered; capped at the
// first 4 the role can see so the bar never overflows.
const TABS: Tab[] = [
  // Not "Ringkasan": a role holding both (the super admin) saw two tabs with one name.
  // Neutral, because the super admin owns no franchise of their own.
  {
    href: '/dashboard/franchise',
    label: 'hrFix.opsNav.franchise',
    icon: Buildings,
    show: canViewFranchise,
  },
  { href: '/dashboard', label: 'hrFix.opsNav.summary', icon: ChartLineUp, show: canViewDashboard },
  // The queue page's own gate (`orders:511`): HR, marketing and the franchise owner were
  // offered a tab that opened onto "no access".
  {
    href: '/dashboard/orders',
    label: 'hrFix.opsNav.queue',
    icon: ClipboardText,
    show: (r) => can('orderManageRead', r),
  },
  {
    href: '/dashboard/inventory',
    label: 'hrFix.opsNav.inventory',
    icon: Package,
    show: canViewInventory,
  },
  {
    href: '/dashboard/forecast',
    label: 'hrFix.opsNav.forecast',
    icon: TrendUp,
    show: canViewForecast,
  },
  { href: '/dashboard/pricing', label: 'hrFix.opsNav.pricing', icon: Tag, show: canManagePricing },
];

export function OpsBottomNav() {
  const { t } = useT();
  // The APK export runs with `trailingSlash: true`: a path with or without its final slash is one screen.
  const pathname = normalisePath(usePathname() ?? '');
  const { customer } = useAuth();
  const role = customer?.role;

  const visible = TABS.filter((t) => t.show(role)).slice(0, 4);
  // A staff role with no tab of its own still needs "Lainnya": on a phone it is the whole menu
  // and the only way out.
  if (!isStaff(role)) return null;

  // One current item across the bar and its "Lainnya" sheet, by the rail's rule: on
  // `/dashboard/franchise/attendance` that is the sheet's attendance row, not the bar's
  // franchise tab as well.
  const current = deepest(
    [...visible, ...GROUPS.flatMap((g) => g.items).filter((i) => i.show(role))],
    pathname,
    '/dashboard',
  )?.href;

  return (
    /* Measured at 320px in English: five labels plus padding made the bar itself 338px
       wide, so the bar that is supposed to be the floor of the screen was the thing
       pushing the page sideways. `min-w-0` on the tabs lets them shrink; `px-1` gives
       back the 8px the bar did not have. */
    <nav
      className="fixed inset-x-0 bottom-0 z-30 flex max-w-[100vw] items-end justify-around overflow-hidden border-t border-app bg-[color:var(--surface)]/95 px-1 pb-[max(16px,var(--safe-area-inset-bottom,env(safe-area-inset-bottom)))] pt-2.5 backdrop-blur-[8px] sm:px-2 lg:hidden"
      aria-label="Navigasi operasi"
    >
      {visible.map((tab) => {
        const on = tab.href === current;
        const Ic = tab.icon;
        return (
          <Link
            key={tab.href + tab.label}
            href={tab.href}
            aria-current={on ? 'page' : undefined}
            className={
              'flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center gap-[3px] px-0.5 text-center text-[10px] font-extrabold leading-tight transition-colors ' +
              (on ? 'text-brand-600' : 'text-[color:var(--text-muted)]')
            }
          >
            <Ic size={21} weight={on ? 'fill' : 'regular'} />
            {/* The English labels are longer than the Indonesian ones and made the bar itself
                18px wider than a 320px screen. A tab that cannot shrink below its longest
                word is a tab that pushes the whole page sideways. */}
            <span className="w-full truncate">{t(tab.label)}</span>
          </Link>
        );
      })}
      {/* B2. This was a `<span>`: styled exactly like the four real tabs beside it, and
          doing nothing. The comment said "full menu is the desktop rail" — which meant a
          depot manager on a phone could reach four screens and no others, and could not
          re-scope the console to another depot at all. */}
      <MoreSheetTab current={current} />
    </nav>
  );
}

/**
 * The rest of the console, on a phone.
 *
 * Renders `GROUPS` from `lib/ops-nav` rather than its own copy: one list, two surfaces. A
 * second copy would drift the first time a route is added to one and not the other, and
 * the symptom would be a screen that exists on desktop and is simply unreachable on a
 * phone — which is the defect this replaces.
 */
function MoreSheetTab({ current }: { current: string | undefined }) {
  const { customer } = useAuth();
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const role = customer?.role;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="tap-44 flex min-h-11 flex-col items-center justify-center gap-[3px] text-[10px] font-bold text-[color:var(--text-muted)]"
      >
        <DotsThreeOutline size={21} />
        {t('opsFix.nav.more')}
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title={t('ops.more.title')}>
        <div className="flex flex-col gap-1 pb-2">
          {/* A depot-scoped console whose switcher only exists on desktop is a console a
              depot manager cannot re-scope from the floor. */}
          <div className="pb-2">
            <DepotSwitcher />
          </div>
          {/* PR-3b: one row per hub, as on the rail; the hub's screens are tabs on its pages. */}
          {hubsFor(role).map(({ hub, items }) => {
            const Ic = hub.icon;
            const on = items.some((i) => i.href === current);
            return (
              <Link
                aria-current={on ? 'page' : undefined}
                key={hub.headKey}
                href={items[0]!.href}
                onClick={() => setOpen(false)}
                className={
                  'flex items-center gap-2.5 rounded-[10px] px-2 py-2.5 text-[14px] transition-colors ' +
                  (on ? 'bg-brand-50 font-extrabold text-brand-800' : 'text-[color:var(--text)]')
                }
              >
                <Ic size={19} weight={on ? 'fill' : 'regular'} />
                {t(`ops.groups.${hub.headKey}`)}
              </Link>
            );
          })}
          {/* CA-2-61: on a phone the rail is hidden, so this sheet is the only place an
              exit can live. */}
          <div className="mt-2 border-t border-app pt-2">
            <ConsoleSignOut />
          </div>
        </div>
      </Sheet>
    </>
  );
}
