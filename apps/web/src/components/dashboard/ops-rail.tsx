'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import {
  Bell,
  Buildings,
  CaretUpDown,
  ChartLineUp,
  ChatCircleText,
  CheckCircle,
  ClipboardText,
  Coins,
  HandCoins,
  Receipt,
  MagnifyingGlass,
  MapPin,
  Megaphone,
  Package,
  Recycle,
  ShieldCheck,
  Storefront,
  UserGear,
  Tag,
  Ticket,
  TrendUp,
  UsersThree,
  Wallet,
  type Icon,
} from '@phosphor-icons/react';

import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { useT } from '@/lib/locale-context';
import {
  canManageDepots,
  canManagePricing,
  canManageStaff,
  canViewCampaigns,
  canViewChurn,
  canViewDashboard,
  canViewForecast,
  canViewFranchise,
  canViewInventory,
  canViewOpsNotifications,
  canApproveExpense,
  canManageEarningRules,
  canViewPayout,
  canViewReturns,
  canViewTracking,
  canViewVouchers,
  canVerifySettlement,
  isStaff,
} from '@/lib/roles';

type Role = string | null | undefined;

interface RailItem {
  href: string;
  // i18n key under ops.nav.* — resolved at render via t().
  labelKey: string;
  icon: Icon;
  show: (role: Role) => boolean;
}
interface RailGroup {
  // i18n key under ops.groups.*
  headKey: string;
  items: RailItem[];
}

// Grouped by job-to-be-done. Each item is role-gated (chrome only — the server
// stays authoritative); groups with no visible items collapse.
const GROUPS: RailGroup[] = [
  {
    headKey: 'summary',
    items: [
      { href: '/dashboard/franchise', labelKey: 'myFranchise', icon: Buildings, show: canViewFranchise },
      { href: '/dashboard', labelKey: 'operations', icon: ChartLineUp, show: canViewDashboard },
      { href: '/dashboard/search', labelKey: 'search', icon: MagnifyingGlass, show: isStaff },
    ],
  },
  {
    headKey: 'daily',
    items: [
      { href: '/dashboard/orders', labelKey: 'orders', icon: ClipboardText, show: isStaff },
      { href: '/dashboard/tracking', labelKey: 'tracking', icon: MapPin, show: canViewTracking },
      { href: '/dashboard/inventory', labelKey: 'inventory', icon: Package, show: canViewInventory },
      { href: '/dashboard/returns', labelKey: 'returns', icon: Recycle, show: canViewReturns },
      { href: '/dashboard/notifications', labelKey: 'notifications', icon: Bell, show: canViewOpsNotifications },
      { href: '/dashboard/settlements', labelKey: 'settlements', icon: HandCoins, show: canVerifySettlement },
      { href: '/dashboard/forecast', labelKey: 'forecast', icon: TrendUp, show: canViewForecast },
    ],
  },
  {
    headKey: 'network',
    items: [
      { href: '/dashboard/depots', labelKey: 'depots', icon: Storefront, show: canManageDepots },
      { href: '/dashboard/pricing', labelKey: 'pricing', icon: Tag, show: canManagePricing },
      { href: '/dashboard/staff', labelKey: 'staff', icon: UserGear, show: canManageStaff },
    ],
  },
  {
    headKey: 'marketing',
    items: [
      { href: '/dashboard/promotions', labelKey: 'promo', icon: Megaphone, show: canViewCampaigns },
      { href: '/dashboard/campaigns', labelKey: 'campaign', icon: ChatCircleText, show: canViewCampaigns },
      { href: '/dashboard/vouchers', labelKey: 'vouchers', icon: Ticket, show: canViewVouchers },
      { href: '/dashboard/churn', labelKey: 'churn', icon: UsersThree, show: canViewChurn },
    ],
  },
  {
    headKey: 'finance',
    items: [
      { href: '/dashboard/payout', labelKey: 'payout', icon: Wallet, show: canViewPayout },
      { href: '/dashboard/expense-claims', labelKey: 'expenseClaims', icon: Receipt, show: canApproveExpense },
      { href: '/dashboard/earning-rules', labelKey: 'earningRules', icon: Coins, show: canManageEarningRules },
    ],
  },
];

const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'Super admin',
  HEAD_OFFICE: 'Head office',
  DEPOT_MANAGER: 'Depot manager',
  DEPOT_OPERATOR: 'Depot operator',
  MARKETING: 'Marketing',
  FRANCHISE_OWNER: 'Franchise owner',
};

function DepotSwitcher() {
  const { depots, selectedId, selected, setSelected } = useDepot();
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const scoped = selectedId != null && selected != null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={
          'flex w-full items-center gap-2.5 rounded-xl border px-2.5 py-2.5 text-left transition-colors ' +
          (scoped ? 'border-brand-600 bg-brand-50' : 'border-app hover:border-brand-600')
        }
      >
        <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg bg-brand-50">
          {scoped ? (
            <Storefront size={16} weight="fill" className="text-brand-600" />
          ) : (
            <Buildings size={16} weight="fill" className="text-brand-600" />
          )}
        </span>
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-[12.5px] font-extrabold">
            {scoped ? selected.name : t('ops.switcher.all')}
          </span>
          <span className="block truncate text-[10.5px] text-muted">
            {scoped
              ? `${selected.code} · ${t('ops.switcher.activeContext')}`
              : t('ops.switcher.locations', { n: depots.length })}
          </span>
        </span>
        <CaretUpDown size={14} className={scoped ? 'text-brand-600' : 'text-muted'} />
      </button>

      {open && (
        <div className="absolute inset-x-0 top-[calc(100%+6px)] z-20 rounded-2xl border border-app surface p-1.5 shadow-lift">
          <SwitcherRow
            active={selectedId == null}
            title={t('ops.switcher.all')}
            meta={t('ops.switcher.combined', { n: depots.length })}
            onClick={() => {
              setSelected(null);
              setOpen(false);
            }}
          />
          {depots.map((d) => (
            <SwitcherRow
              key={d.id}
              active={selectedId === d.id}
              title={d.name}
              meta={`${d.code} · ${d.city}`}
              onClick={() => {
                setSelected(d.id);
                setOpen(false);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SwitcherRow({
  active,
  title,
  meta,
  onClick,
}: {
  active: boolean;
  title: string;
  meta: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-left transition-colors ' +
        (active ? 'bg-brand-50' : 'hover:bg-[color:var(--surface-soft)]')
      }
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-brand-50">
        <Buildings size={14} weight="fill" className="text-brand-600" />
      </span>
      <span className="min-w-0 flex-1 leading-tight">
        <span className="block truncate text-[12.5px] font-semibold">{title}</span>
        <span className="block truncate text-[10.5px] text-muted">{meta}</span>
      </span>
      {active && <CheckCircle size={17} weight="fill" className="text-brand-600" />}
    </button>
  );
}

export function OpsRail() {
  const { customer } = useAuth();
  const { t, locale, setLocale } = useT();
  const pathname = usePathname();
  const role = customer?.role;

  const isActive = (href: string) =>
    href === '/dashboard' ? pathname === '/dashboard' : pathname.startsWith(href);

  return (
    <aside className="surface sticky top-[72px] hidden h-[calc(100dvh-72px)] w-[242px] shrink-0 flex-col overflow-y-auto border-r border-app px-3.5 py-4 lg:flex">
      <DepotSwitcher />

      <nav className="mt-3.5 flex flex-col gap-px">
        {GROUPS.map((group) => {
          const items = group.items.filter((i) => i.show(role));
          if (items.length === 0) return null;
          return (
            <div key={group.headKey}>
              <p className="px-3 pb-1.5 pt-3.5 text-[10.5px] font-extrabold uppercase tracking-[0.08em] text-[color:var(--text-muted)]">
                {t(`ops.groups.${group.headKey}`)}
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
                    <Ic size={18} weight="fill" className={on ? 'text-brand-600' : 'text-[color:var(--text-muted)]'} />
                    <span className="flex-1">{t(`ops.nav.${item.labelKey}`)}</span>
                  </Link>
                );
              })}
            </div>
          );
        })}
      </nav>

      <div className="mt-auto flex flex-col gap-1 pt-2">
        <div className="flex items-center justify-between px-3 py-1.5">
          <span className="text-xs font-medium text-muted">{t('ops.language')}</span>
          <div className="flex overflow-hidden rounded-full border border-app text-[11px] font-bold">
            {(['id', 'en'] as const).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLocale(l)}
                aria-pressed={locale === l}
                className={`px-2.5 py-1 uppercase transition-colors ${
                  locale === l ? 'bg-brand-600 text-on-brand' : 'text-muted hover:bg-[color:var(--surface-soft)]'
                }`}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
        {role && (
          <div className="flex items-center gap-2 px-3 py-2.5 text-xs text-muted">
            <ShieldCheck size={15} className="text-brand-600" />
            {t('ops.role')}: <strong className="text-[color:var(--text)]">{ROLE_LABELS[role] ?? role}</strong>
          </div>
        )}
      </div>
    </aside>
  );
}
