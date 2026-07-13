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
  canViewPayout,
  canViewReturns,
  canViewVouchers,
  isStaff,
} from '@/lib/roles';

type Role = string | null | undefined;

interface RailItem {
  href: string;
  label: string;
  icon: Icon;
  show: (role: Role) => boolean;
}
interface RailGroup {
  head: string;
  items: RailItem[];
}

// Grouped by job-to-be-done. Each item is role-gated (chrome only — the server
// stays authoritative); groups with no visible items collapse.
const GROUPS: RailGroup[] = [
  {
    head: 'Ringkasan',
    items: [
      { href: '/dashboard/franchise', label: 'My Franchise', icon: Buildings, show: canViewFranchise },
      { href: '/dashboard', label: 'Operations', icon: ChartLineUp, show: canViewDashboard },
    ],
  },
  {
    head: 'Operasi harian',
    items: [
      { href: '/dashboard/orders', label: 'Antrean pesanan', icon: ClipboardText, show: isStaff },
      { href: '/dashboard/inventory', label: 'Inventori', icon: Package, show: canViewInventory },
      { href: '/dashboard/returns', label: 'Retur galon', icon: Recycle, show: canViewReturns },
      { href: '/dashboard/notifications', label: 'Notifikasi ops', icon: Bell, show: canViewOpsNotifications },
      { href: '/dashboard/forecast', label: 'Perkiraan', icon: TrendUp, show: canViewForecast },
    ],
  },
  {
    head: 'Jaringan',
    items: [
      { href: '/dashboard/depots', label: 'Depot', icon: Storefront, show: canManageDepots },
      { href: '/dashboard/pricing', label: 'Harga dinamis', icon: Tag, show: canManagePricing },
      { href: '/dashboard/staff', label: 'Staf & peran', icon: UserGear, show: canManageStaff },
    ],
  },
  {
    head: 'Pemasaran',
    items: [
      { href: '/dashboard/promotions', label: 'Promo', icon: Megaphone, show: canViewCampaigns },
      { href: '/dashboard/campaigns', label: 'Campaign', icon: ChatCircleText, show: canViewCampaigns },
      { href: '/dashboard/vouchers', label: 'Voucher', icon: Ticket, show: canViewVouchers },
      { href: '/dashboard/churn', label: 'Risiko churn', icon: UsersThree, show: canViewChurn },
    ],
  },
  {
    head: 'Keuangan · usulan',
    items: [
      { href: '/dashboard/payout', label: 'Payout & komisi', icon: Wallet, show: canViewPayout },
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
            {scoped ? selected.name : 'Semua depot'}
          </span>
          <span className="block truncate text-[10.5px] text-muted">
            {scoped ? `${selected.code} · konteks aktif` : `${depots.length} lokasi`}
          </span>
        </span>
        <CaretUpDown size={14} className={scoped ? 'text-brand-600' : 'text-muted'} />
      </button>

      {open && (
        <div className="absolute inset-x-0 top-[calc(100%+6px)] z-20 rounded-2xl border border-app surface p-1.5 shadow-lift">
          <SwitcherRow
            active={selectedId == null}
            title="Semua depot"
            meta={`${depots.length} lokasi · gabungan`}
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
            <div key={group.head}>
              <p className="px-3 pb-1.5 pt-3.5 text-[10.5px] font-extrabold uppercase tracking-[0.08em] text-[color:var(--text-muted)]">
                {group.head}
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
                    <span className="flex-1">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          );
        })}
      </nav>

      {role && (
        <div className="mt-auto flex items-center gap-2 px-3 py-2.5 text-xs text-muted">
          <ShieldCheck size={15} className="text-brand-600" />
          Peran: <strong className="text-[color:var(--text)]">{ROLE_LABELS[role] ?? role}</strong>
        </div>
      )}
    </aside>
  );
}
