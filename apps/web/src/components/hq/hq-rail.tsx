'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ChartLineUp,
  ClipboardText,
  Drop,
  Gauge,
  MagnifyingGlass,
  Package,
  ShieldCheck,
  TreeStructure,
  Storefront,
  Tag,
  TrendUp,
  UserGear,
  Buildings,
  Wallet,
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
  Handshake,
  type Icon,
} from '@phosphor-icons/react';

import { ConsoleSignOut } from '@/components/console-sign-out';
import { useAuth } from '@/lib/auth-context';
import { useT } from '@/lib/locale-context';
import { can, isHq, type Capability } from '@/lib/roles';
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
  /**
   * Capability the screen genuinely needs, when the HQ gate alone is not enough.
   *
   * The comment below used to say items "don't carry finer gates in Milestone A", and a
   * browser pass as a real HEAD_OFFICE proved that assumption wrong: six platform-admin
   * screens are `platformAdmin` (SUPER_ADMIN only) server-side and answered 403 while
   * sitting in the nav of every role the console admits. A menu entry that can only ever
   * fail reads as a broken system, not as a permission boundary.
   */
  cap?: Capability;
}
export interface HqRailGroup {
  // i18n key under hq.groups.*
  headKey: string;
  items: HqRailItem[];
}

// Full HQ area-map (design 11a). The layout gate admits HEAD_OFFICE, DIREKTUR and
// SUPER_ADMIN; items that need MORE than that carry `cap` and are filtered per role by
// `hqGroupsForRole`. (This comment used to say no item needed a finer gate — six of them
// did, and only a browser pass as a real head-office account found out.) Only `ready`
// items render; the rest sit here so wiring a later milestone is a one-line flag flip.
//
// The last three `ready: false` entries (/hq/flow, /hq/system, /hq/admin) are gone: no page
// was ever written for any of them, so the flag could not be flipped — they were a to-do
// list pretending to be a feature flag.
export const HQ_GROUPS: HqRailGroup[] = [
  {
    headKey: 'overview',
    items: [
      { href: '/hq', labelKey: 'overview', icon: ChartLineUp, ready: true },
      { href: '/hq/search', labelKey: 'search', icon: MagnifyingGlass, ready: true },
      { href: '/hq/access', labelKey: 'access', icon: ShieldCheck, ready: true , cap: 'accessMatrixWrite' },
    ],
  },
  {
    headKey: 'network',
    items: [
      { href: '/hq/depots', labelKey: 'depots', icon: Storefront, ready: true },
      { href: '/hq/hierarchy', labelKey: 'hierarchy', icon: TreeStructure, ready: true, cap: 'hierarchyAdmin' },
      // The depot console, which HQ can open but had no door to: the shop nav that
      // carries its link is stripped on console routes, so from here /dashboard was
      // reachable only by typing the URL — and with it the pelanggan/stok/harga imports.
      { href: '/dashboard', labelKey: 'opsConsole', icon: Gauge, ready: true },
    ],
  },
  {
    headKey: 'staff',
    items: [
      { href: '/hq/staff', labelKey: 'staff', icon: UserGear, ready: true, cap: 'staffAdmin' },
      { href: '/hr', labelKey: 'hr', icon: UsersThree, ready: true },
    ],
  },
  {
    headKey: 'franchise',
    items: [
      { href: '/hq/applications', labelKey: 'applications', icon: FileText, ready: true },
      { href: '/hq/franchise', labelKey: 'franchise', icon: Buildings, ready: true, cap: 'hqPayoutRead' },
    ],
  },
  {
    headKey: 'finance',
    items: [
      { href: '/hq/payments', labelKey: 'payments', icon: Wallet, ready: true, cap: 'hqPayoutRead' },
      { href: '/hq/pricing', labelKey: 'pricing', icon: Tag, ready: true },
      { href: '/hq/vouchers', labelKey: 'vouchers', icon: Ticket, ready: true, cap: 'voucherRead' },
      { href: '/hq/refunds', labelKey: 'refunds', icon: Receipt, ready: true, cap: 'refundQueueRead' },
      { href: '/hq/reconciliation', labelKey: 'reconciliation', icon: Scales, ready: true, cap: 'commissionRead' },
      { href: '/hq/reports/export', labelKey: 'reportsExport', icon: Export, ready: true },
      { href: '/hq/tax', labelKey: 'tax', icon: Invoice, ready: true , cap: 'taxSettings' },
    ],
  },
  {
    headKey: 'daily',
    items: [
      { href: '/hq/inventory', labelKey: 'inventory', icon: Package, ready: true },
      { href: '/hq/returns', labelKey: 'returns', icon: Recycle, ready: true, cap: 'returnsRead' },
      { href: '/hq/roster', labelKey: 'roster', icon: Truck, ready: true , cap: 'driverRoster' },
      { href: '/hq/orders', labelKey: 'orders', icon: ClipboardText, ready: true, cap: 'orderQueue' },
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
      { href: '/hq/churn', labelKey: 'churn', icon: UsersThree, ready: true, cap: 'churn' },
      { href: '/hq/campaigns', labelKey: 'campaigns', icon: Megaphone, ready: true , cap: 'campaignRead' },
      { href: '/hq/promotions', labelKey: 'promotions', icon: ImageIcon, ready: true, cap: 'promotionRead' },
      { href: '/hq/customers', labelKey: 'customers', icon: UserCircle, ready: true, cap: 'customerPhoneLookup' },
      // ponytail: depot managers reach /resellers by direct URL for now — no manager-rail
      // entry yet (out of scope for this pass).
      { href: '/resellers', labelKey: 'resellers', icon: Handshake, ready: true, cap: 'resellerView' },
    ],
  },
  {
    headKey: 'catalog',
    items: [
      { href: '/hq/catalog', labelKey: 'catalog', icon: Package, ready: true , cap: 'catalogWrite' },
      { href: '/hq/loyalty', labelKey: 'loyalty', icon: Crown, ready: true, cap: 'rewardCatalog' },
      { href: '/hq/subscriptions', labelKey: 'subscriptions', icon: ArrowsClockwise, ready: true, cap: 'hqConsole' },
    ],
  },
  {
    headKey: 'forms',
    items: [
      { href: '/hq/forms/pricing-rule', labelKey: 'formPricingRule', icon: SlidersHorizontal, ready: true, cap: 'depotAdmin' },
      { href: '/hq/forms/voucher', labelKey: 'formVoucher', icon: Ticket, ready: true, cap: 'voucherWrite' },
      { href: '/hq/forms/commission', labelKey: 'formCommission', icon: Percent, ready: true, cap: 'commissionRead' },
      { href: '/hq/forms/segment', labelKey: 'formSegment', icon: UsersThree, ready: true, cap: 'campaignWrite' },
      { href: '/hq/staff/import', labelKey: 'staffImport', icon: UploadSimple, ready: true, cap: 'staffAdmin' },
      { href: '/hq/broadcast', labelKey: 'broadcast', icon: Broadcast, ready: true , cap: 'campaignWrite' },
    ],
  },
  {
    headKey: 'flow',
    items: [
      { href: '/hq/incidents', labelKey: 'incidents', icon: WarningOctagon, ready: true, cap: 'hqConsole' },
      { href: '/hq/tickets', labelKey: 'tickets', icon: ChatCircleDots, ready: true, cap: 'hqConsole' },
      { href: '/hq/fraud', labelKey: 'fraud', icon: ShieldWarning, ready: true },
      { href: '/hq/scheduled-reports', labelKey: 'scheduledReports', icon: CalendarCheck, ready: true, cap: 'hqConsole' },
      { href: '/hq/onboarding', labelKey: 'onboarding', icon: ListChecks, ready: true , cap: 'depotDirectory' },
    ],
  },
  {
    headKey: 'system',
    items: [
      { href: '/hq/audit', labelKey: 'audit', icon: ClockCounterClockwise, ready: true },
      { href: '/hq/flags', labelKey: 'flags', icon: Flag, ready: true, cap: 'platformAdmin' },
      { href: '/hq/health', labelKey: 'health', icon: Heartbeat, ready: true, cap: 'hqConsole' },
      { href: '/hq/exports', labelKey: 'exports', icon: FileArrowDown, ready: true, cap: 'hqConsole' },
      { href: '/hq/api-keys', labelKey: 'apiKeys', icon: Key, ready: true, cap: 'platformAdmin' },
      { href: '/hq/webhooks', labelKey: 'webhooks', icon: Plugs, ready: true, cap: 'platformAdmin' },
      { href: '/hq/sla-policy', labelKey: 'slaPolicy', icon: Timer, ready: true , cap: 'depotAdmin' },
      { href: '/hq/forecast-models', labelKey: 'forecastModels', icon: ChartLineUp, ready: true, cap: 'forecast' },
      { href: '/hq/retention', labelKey: 'retention', icon: Archive, ready: true, cap: 'platformAdmin' },
      { href: '/hq/pdp', labelKey: 'pdp', icon: ShieldCheck, ready: true , cap: 'pdpRequests' },
      { href: '/hq/security', labelKey: 'security', icon: Lock, ready: true, cap: 'platformAdmin' },
    ],
  },
  {
    headKey: 'admin',
    items: [
      { href: '/hq/profile', labelKey: 'profile', icon: IdentificationBadge, ready: true },
      { href: '/hq/wizard', labelKey: 'wizard', icon: Sparkle, ready: true, cap: 'platformAdmin' },
      { href: '/hq/invoice-template', labelKey: 'invoiceTemplate', icon: Article, ready: true , cap: 'taxSettings' },
      { href: '/hq/content', labelKey: 'content', icon: Translate, ready: true },
      { href: '/hq/sitemap', labelKey: 'sitemap', icon: SquaresFour, ready: true },
    ],
  },
];

/**
 * The nav model as THIS role may see it — groups that end up empty drop out.
 *
 * One helper for every surface derived from `HQ_GROUPS` (the rail, the screen index, the
 * command palette, the access landing). Four copies of the filter would drift, and a
 * screen index still listing a door the rail has hidden is the same lie wearing a hat.
 */
export function hqGroupsForRole(role: Role): HqRailGroup[] {
  if (!isHq(role)) return [];
  return HQ_GROUPS.map((g) => ({
    ...g,
    // `cap` filters on top of the console gate: an item whose capability this role lacks is
    // not shown at all, rather than shown and then refused by the server.
    items: g.items.filter((i) => i.ready && (!i.cap || can(i.cap, role))),
  })).filter((g) => g.items.length > 0);
}

export function hqItemsForRole(role: Role): HqRailItem[] {
  return hqGroupsForRole(role).flatMap((g) => g.items);
}

/**
 * The capability a /hq path needs, or null when the console gate is the whole of it.
 *
 * CA-2-60: 58 of the 64 /hq pages gated nothing of their own. The rail hid what a role
 * could not use, and typing the URL walked straight past that — onto a screen that then
 * fetched, got 403s, and rendered as an error or, worse, as empty. Hiding a link is not
 * an access rule; it is a courtesy on top of one.
 *
 * Rather than 61 copies of the same three lines, the layout asks this. The answer comes
 * from the SAME table the rail filters on, so the two can never disagree: a capability
 * added to an item gates its page in the same commit.
 *
 * Longest prefix wins, so `/hq/depots/detail` inherits `/hq/depots` and a child that
 * needs MORE than its parent can say so by carrying its own row.
 */
export function capForHqPath(pathname: string | null | undefined): Capability | null {
  if (!pathname) return null;
  let best: { href: string; cap?: Capability } | null = null;
  for (const group of HQ_GROUPS) {
    for (const item of group.items) {
      if (pathname !== item.href && !pathname.startsWith(`${item.href}/`)) continue;
      if (!best || item.href.length > best.href.length) best = item;
    }
  }
  return best?.cap ?? null;
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
        <ConsoleSignOut />
      </div>
    </aside>
  );
}
