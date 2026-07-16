'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ChartLineUp,
  ClipboardText,
  Drop,
  Gear,
  MagnifyingGlass,
  Package,
  ShieldCheck,
  Storefront,
  Stack,
  Tag,
  TrendUp,
  UserGear,
  Buildings,
  Wallet,
  FlowArrow,
  Ticket,
  Receipt,
  Scales,
  Export,
  SlidersHorizontal,
  Percent,
  UsersThree,
  Recycle,
  Truck,
  Bell,
  Trophy,
  ChartBar,
  Megaphone,
  Image as ImageIcon,
  UserCircle,
  Crown,
  ArrowsClockwise,
  UploadSimple,
  Broadcast,
  FileText,
  ClockCounterClockwise,
  Flag,
  Heartbeat,
  FileArrowDown,
  Key,
  Plugs,
  Timer,
  Archive,
  Lock,
  Invoice,
  WarningOctagon,
  ChatCircleDots,
  ShieldWarning,
  CalendarCheck,
  ListChecks,
  IdentificationBadge,
  Sparkle,
  Article,
  Translate,
  SquaresFour,
  Sun,
  Moon,
  Command,
  type Icon,
} from '@phosphor-icons/react';

import { useAuth } from '@/lib/auth-context';
import { useT } from '@/lib/locale-context';
import { isHq } from '@/lib/roles';
import { useTheme } from '@/lib/theme-context';

// Opening the ⌘K palette is decoupled via a window event so the rail doesn't import
// the palette (which imports HQ_GROUPS from here) — keeps the module graph acyclic.
// Paired with the same literal in command-palette.tsx.
const HQ_COMMAND_EVENT = 'hq:command-open';

type Role = string | null | undefined;

export interface HqRailItem {
  href: string;
  // i18n key under hq.nav.*
  labelKey: string;
  icon: Icon;
  // Milestone-A routes render now; others are declared for easy extension but hidden.
  ready: boolean;
}
export interface HqRailGroup {
  // i18n key under hq.groups.*
  headKey: string;
  items: HqRailItem[];
}

// Full HQ area-map (design 11a). The whole console is HEAD_OFFICE/SUPER_ADMIN-only via
// the layout gate, so items don't carry finer gates in Milestone A. Only `ready` items
// render; the rest sit here so wiring a later milestone is a one-line flag flip.
export const HQ_GROUPS: HqRailGroup[] = [
  {
    headKey: 'overview',
    items: [
      { href: '/hq', labelKey: 'overview', icon: ChartLineUp, ready: true },
      { href: '/hq/search', labelKey: 'search', icon: MagnifyingGlass, ready: true },
      { href: '/hq/access', labelKey: 'access', icon: ShieldCheck, ready: true },
    ],
  },
  {
    headKey: 'network',
    items: [{ href: '/hq/depots', labelKey: 'depots', icon: Storefront, ready: true }],
  },
  {
    headKey: 'staff',
    items: [{ href: '/hq/staff', labelKey: 'staff', icon: UserGear, ready: true }],
  },
  {
    headKey: 'franchise',
    items: [
      { href: '/hq/applications', labelKey: 'applications', icon: FileText, ready: true },
      { href: '/hq/franchise', labelKey: 'franchise', icon: Buildings, ready: false },
    ],
  },
  {
    headKey: 'finance',
    items: [
      { href: '/hq/payments', labelKey: 'payments', icon: Wallet, ready: true },
      { href: '/hq/pricing', labelKey: 'pricing', icon: Tag, ready: true },
      { href: '/hq/vouchers', labelKey: 'vouchers', icon: Ticket, ready: true },
      { href: '/hq/refunds', labelKey: 'refunds', icon: Receipt, ready: true },
      { href: '/hq/reconciliation', labelKey: 'reconciliation', icon: Scales, ready: true },
      { href: '/hq/reports/export', labelKey: 'reportsExport', icon: Export, ready: true },
      { href: '/hq/tax', labelKey: 'tax', icon: Invoice, ready: true },
    ],
  },
  {
    headKey: 'daily',
    items: [
      { href: '/hq/inventory', labelKey: 'inventory', icon: Package, ready: true },
      { href: '/hq/returns', labelKey: 'returns', icon: Recycle, ready: true },
      { href: '/hq/roster', labelKey: 'roster', icon: Truck, ready: true },
      { href: '/hq/orders', labelKey: 'orders', icon: ClipboardText, ready: true },
      { href: '/hq/notifications', labelKey: 'notifications', icon: Bell, ready: true },
    ],
  },
  {
    headKey: 'analytics',
    items: [
      { href: '/hq/analytics', labelKey: 'analytics', icon: TrendUp, ready: true },
      { href: '/hq/scorecard', labelKey: 'scorecard', icon: Trophy, ready: true },
      { href: '/hq/compare', labelKey: 'compare', icon: ChartBar, ready: true },
      { href: '/hq/forecast', labelKey: 'forecast', icon: ChartLineUp, ready: true },
      { href: '/hq/churn', labelKey: 'churn', icon: UsersThree, ready: true },
      { href: '/hq/campaigns', labelKey: 'campaigns', icon: Megaphone, ready: true },
      { href: '/hq/promotions', labelKey: 'promotions', icon: ImageIcon, ready: true },
      { href: '/hq/customers', labelKey: 'customers', icon: UserCircle, ready: true },
    ],
  },
  {
    headKey: 'catalog',
    items: [
      { href: '/hq/catalog', labelKey: 'catalog', icon: Package, ready: true },
      { href: '/hq/loyalty', labelKey: 'loyalty', icon: Crown, ready: true },
      { href: '/hq/subscriptions', labelKey: 'subscriptions', icon: ArrowsClockwise, ready: true },
    ],
  },
  {
    headKey: 'forms',
    items: [
      { href: '/hq/forms/pricing-rule', labelKey: 'formPricingRule', icon: SlidersHorizontal, ready: true },
      { href: '/hq/forms/voucher', labelKey: 'formVoucher', icon: Ticket, ready: true },
      { href: '/hq/forms/commission', labelKey: 'formCommission', icon: Percent, ready: true },
      { href: '/hq/forms/segment', labelKey: 'formSegment', icon: UsersThree, ready: true },
      { href: '/hq/staff/import', labelKey: 'staffImport', icon: UploadSimple, ready: true },
      { href: '/hq/broadcast', labelKey: 'broadcast', icon: Broadcast, ready: true },
    ],
  },
  {
    headKey: 'flow',
    items: [
      { href: '/hq/incidents', labelKey: 'incidents', icon: WarningOctagon, ready: true },
      { href: '/hq/tickets', labelKey: 'tickets', icon: ChatCircleDots, ready: true },
      { href: '/hq/fraud', labelKey: 'fraud', icon: ShieldWarning, ready: true },
      { href: '/hq/scheduled-reports', labelKey: 'scheduledReports', icon: CalendarCheck, ready: true },
      { href: '/hq/onboarding', labelKey: 'onboarding', icon: ListChecks, ready: true },
      { href: '/hq/flow', labelKey: 'flow', icon: FlowArrow, ready: false },
    ],
  },
  {
    headKey: 'system',
    items: [
      { href: '/hq/audit', labelKey: 'audit', icon: ClockCounterClockwise, ready: true },
      { href: '/hq/flags', labelKey: 'flags', icon: Flag, ready: true },
      { href: '/hq/health', labelKey: 'health', icon: Heartbeat, ready: true },
      { href: '/hq/exports', labelKey: 'exports', icon: FileArrowDown, ready: true },
      { href: '/hq/api-keys', labelKey: 'apiKeys', icon: Key, ready: true },
      { href: '/hq/webhooks', labelKey: 'webhooks', icon: Plugs, ready: true },
      { href: '/hq/sla-policy', labelKey: 'slaPolicy', icon: Timer, ready: true },
      { href: '/hq/retention', labelKey: 'retention', icon: Archive, ready: true },
      { href: '/hq/security', labelKey: 'security', icon: Lock, ready: true },
      { href: '/hq/system', labelKey: 'system', icon: Gear, ready: false },
    ],
  },
  {
    headKey: 'admin',
    items: [
      { href: '/hq/profile', labelKey: 'profile', icon: IdentificationBadge, ready: true },
      { href: '/hq/wizard', labelKey: 'wizard', icon: Sparkle, ready: true },
      { href: '/hq/invoice-template', labelKey: 'invoiceTemplate', icon: Article, ready: true },
      { href: '/hq/content', labelKey: 'content', icon: Translate, ready: true },
      { href: '/hq/sitemap', labelKey: 'sitemap', icon: SquaresFour, ready: true },
      { href: '/hq/admin', labelKey: 'admin', icon: Stack, ready: false },
    ],
  },
];

export function hqItemsForRole(role: Role): HqRailItem[] {
  if (!isHq(role)) return [];
  return HQ_GROUPS.flatMap((g) => g.items).filter((i) => i.ready);
}

export function HqRail() {
  const { customer } = useAuth();
  const { t, locale, setLocale } = useT();
  const { resolved, toggle: toggleTheme } = useTheme();
  const pathname = usePathname();
  const role = customer?.role;

  const isActive = (href: string) =>
    href === '/hq' ? pathname === '/hq' : pathname.startsWith(href);

  return (
    <aside className="surface sticky top-[72px] hidden h-[calc(100dvh-72px)] w-[242px] shrink-0 flex-col overflow-y-auto border-r border-app px-3.5 py-4 lg:flex">
      {/* Brand header — HQ is network-wide, so no depot switcher. */}
      <div className="flex items-center gap-2.5 rounded-xl bg-deep-teal px-3 py-3 text-white">
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
        {HQ_GROUPS.map((group) => {
          const items = group.items.filter((i) => i.ready && isHq(role));
          if (items.length === 0) return null;
          return (
            <div key={group.headKey}>
              <p className="px-3 pb-1.5 pt-3.5 text-[10.5px] font-extrabold uppercase tracking-[0.08em] text-[color:var(--text-muted)]">
                {t(`hq.groups.${group.headKey}`)}
              </p>
              {items.map((item) => {
                const on = isActive(item.href);
                const Ic = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
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
      </div>
    </aside>
  );
}
