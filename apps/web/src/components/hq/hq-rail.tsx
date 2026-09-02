'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Icon } from '@phosphor-icons/react';
import {
  Archive,
  ArrowsClockwise,
  Article,
  Bell,
  Broadcast,
  Buildings,
  CalendarCheck,
  ChartBar,
  ChartLineUp,
  ChatCircleDots,
  ClipboardText,
  ClockCounterClockwise,
  Command,
  Crown,
  Drop,
  Export,
  FileArrowDown,
  FileText,
  Flag,
  Gauge,
  Handshake,
  Heartbeat,
  IdentificationBadge,
  ImageIcon,
  Invoice,
  Key,
  ListChecks,
  Lock,
  MagnifyingGlass,
  Megaphone,
  Moon,
  Package,
  Percent,
  Plugs,
  Receipt,
  Recycle,
  Scales,
  ShieldCheck,
  ShieldWarning,
  SlidersHorizontal,
  Sparkle,
  SquaresFour,
  Storefront,
  Sun,
  Tag,
  Ticket,
  Timer,
  Translate,
  TreeStructure,
  TrendUp,
  Trophy,
  Truck,
  UploadSimple,
  UserCircle,
  UserGear,
  UsersThree,
  Wallet,
  WarningOctagon,
} from '@phosphor-icons/react';

import { ConsoleSignOut } from '@/components/console-sign-out';
import { hqGroupsForRole } from '@/lib/hq-nav';
import { useAuth } from '@/lib/auth-context';
import { useT } from '@/lib/locale-context';
import { useTheme } from '@/lib/theme-context';

// Opening the ⌘K palette is decoupled via a window event so the rail doesn't import
// the palette (which imports HQ_GROUPS from here) — keeps the module graph acyclic.
// Paired with the same literal in command-palette.tsx.
const HQ_COMMAND_EVENT = 'hq:command-open';


/**
 * The picture for each door.
 *
 * Kept OUT of `lib/hq-nav.ts` and here, with the component that draws it. The model moved
 * to `lib` so `roles.ts` could answer "where does this role land" from the same table — and
 * `roles.ts` is imported by nearly every page, so the fifty-five console icons travelled
 * with it into the customer bundle. Measured by the Lighthouse ratchet: /products grew
 * 19KB and /login 23KB for a table neither page renders. An icon is a view detail; the
 * href and the capability are the model.
 */
export const HQ_ICONS: Record<string, Icon> = {
  '/hq': ChartLineUp,
  '/hq/search': MagnifyingGlass,
  '/hq/access': ShieldCheck,
  '/hq/depots': Storefront,
  '/hq/hierarchy': TreeStructure,
  '/dashboard': Gauge,
  '/hq/staff': UserGear,
  '/hr': UsersThree,
  '/hq/applications': FileText,
  '/hq/franchise': Buildings,
  '/hq/payments': Wallet,
  '/hq/pricing': Tag,
  '/hq/vouchers': Ticket,
  '/hq/refunds': Receipt,
  '/hq/reconciliation': Scales,
  '/hq/reports/export': Export,
  '/hq/tax': Invoice,
  '/hq/inventory': Package,
  '/hq/returns': Recycle,
  '/hq/roster': Truck,
  '/hq/orders': ClipboardText,
  '/hq/notifications': Bell,
  '/hq/analytics': TrendUp,
  '/hq/scorecard': Trophy,
  '/hq/compare': ChartBar,
  '/hq/forecast': ChartLineUp,
  '/hq/churn': UsersThree,
  '/hq/campaigns': Megaphone,
  '/hq/promotions': ImageIcon,
  '/hq/customers': UserCircle,
  '/resellers': Handshake,
  '/hq/catalog': Package,
  '/hq/loyalty': Crown,
  '/hq/subscriptions': ArrowsClockwise,
  '/hq/forms/pricing-rule': SlidersHorizontal,
  '/hq/forms/voucher': Ticket,
  '/hq/forms/commission': Percent,
  '/hq/forms/segment': UsersThree,
  '/hq/staff/import': UploadSimple,
  '/hq/broadcast': Broadcast,
  '/hq/incidents': WarningOctagon,
  '/hq/tickets': ChatCircleDots,
  '/hq/fraud': ShieldWarning,
  '/hq/scheduled-reports': CalendarCheck,
  '/hq/onboarding': ListChecks,
  '/hq/audit': ClockCounterClockwise,
  '/hq/flags': Flag,
  '/hq/health': Heartbeat,
  '/hq/exports': FileArrowDown,
  '/hq/api-keys': Key,
  '/hq/webhooks': Plugs,
  '/hq/sla-policy': Timer,
  '/hq/forecast-models': ChartLineUp,
  '/hq/retention': Archive,
  '/hq/pdp': ShieldCheck,
  '/hq/security': Lock,
  '/hq/profile': IdentificationBadge,
  '/hq/wizard': Sparkle,
  '/hq/invoice-template': Article,
  '/hq/content': Translate,
  '/hq/sitemap': SquaresFour,
};

export function HqRail() {
  const { customer } = useAuth();
  const { t, locale, setLocale } = useT();
  const { resolved, toggle: toggleTheme } = useTheme();
  const pathname = usePathname();
  const role = customer?.role;

  const isActive = (href: string) =>
    href === '/hq' ? pathname === '/hq' : pathname.startsWith(href);

  return (
    <aside className="surface sticky top-0 hidden h-dvh w-[242px] shrink-0 flex-col overflow-y-auto border-r border-app px-3.5 py-4 lg:flex">
      {/* Brand header — HQ is network-wide, so no depot switcher. */}
      <div className="flex min-h-11 items-center gap-2.5 rounded-xl bg-deep-teal px-3 py-3 text-white">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/15">
          <Drop size={18} weight="fill" />
        </span>
        <span className="min-w-0 leading-tight">
          <span className="block truncate text-[12.5px] font-extrabold tracking-tight">
            {t('hq.rail.title')}
          </span>
          <span className="block truncate text-[10.5px] text-white/70">{t('hq.rail.subtitle')}</span>
        </span>
      </div>

      <nav className="mt-3.5 flex flex-col gap-px">
        {hqGroupsForRole(role).map((group) => {
          const items = group.items;
          return (
            <div key={group.headKey}>
              <p className="px-3 pb-1.5 pt-3.5 text-[10.5px] font-extrabold uppercase tracking-[0.08em] text-[color:var(--text-muted)]">
                {t(`hq.groups.${group.headKey}`)}
              </p>
              {items.map((item) => {
                const on = isActive(item.href);
                const Ic = HQ_ICONS[item.href] ?? Drop;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    // The active screen was marked by colour and weight alone, which says
                    // nothing to a screen reader — the whole rail read as sixty
                    // indistinguishable links.
                    aria-current={on ? 'page' : undefined}
                    className={
                      'flex items-center gap-2.5 rounded-[10px] px-3 py-2.5 text-[13.5px] transition-colors ' +
                      (on
                        ? 'bg-brand-50 font-extrabold text-brand-800'
                        : 'font-semibold text-muted hover:bg-[color:var(--surface-soft)]')
                    }
                  >
                    <Ic
                      size={18}
                      weight="fill"
                      className={on ? 'text-brand-600' : 'text-[color:var(--text-muted)]'}
                    />
                    <span className="flex-1">{t(`hq.nav.${item.labelKey}`)}</span>
                  </Link>
                );
              })}
            </div>
          );
        })}
      </nav>

      <div className="mt-auto flex flex-col gap-1 pt-2">
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent(HQ_COMMAND_EVENT))}
          className="mx-3 mb-1 flex items-center justify-between rounded-[10px] border border-app px-3 py-2 text-xs font-semibold text-muted transition-colors hover:bg-[color:var(--surface-soft)]"
        >
          <span className="flex items-center gap-2">
            <Command size={15} weight="bold" />
            {t('hq.common.palette.title')}
          </span>
          <kbd className="rounded border border-app bg-[color:var(--surface-soft)] px-1.5 py-0.5 text-[10px] font-bold">
            {t('hq.common.kbd')}
          </kbd>
        </button>
        <div className="flex items-center justify-between px-3 py-1.5">
          <span className="text-xs font-medium text-muted">{t('hq.language')}</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={t('hq.common.theme.toggle')}
              title={t('hq.common.theme.toggle')}
              className="flex h-7 w-7 items-center justify-center rounded-full border border-app text-muted transition-colors hover:bg-[color:var(--surface-soft)]"
            >
              {resolved === 'dark' ? <Sun size={15} weight="fill" /> : <Moon size={15} weight="fill" />}
            </button>
            <div className="flex overflow-hidden rounded-full border border-app text-[11px] font-bold">
              {(['id', 'en'] as const).map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => setLocale(l)}
                  aria-pressed={locale === l}
                  className={`px-2.5 py-1 uppercase transition-colors ${
                    locale === l
                      ? 'bg-brand-600 text-on-brand'
                      : 'text-muted hover:bg-[color:var(--surface-soft)]'
                  }`}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>
        </div>
        {role && (
          <div className="flex items-center gap-2 px-3 py-2.5 text-xs text-muted">
            <ShieldCheck size={15} className="text-brand-600" />
            {t('hq.role')}:{' '}
            <strong className="text-[color:var(--text)]">{t(`hq.roles.${role}`)}</strong>
          </div>
        )}
        <ConsoleSignOut />
      </div>
    </aside>
  );
}
