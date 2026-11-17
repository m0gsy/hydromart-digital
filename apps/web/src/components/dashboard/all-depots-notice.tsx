'use client';

import { Buildings, LinkBreak } from '@phosphor-icons/react';
import { usePathname } from 'next/navigation';

import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { useT } from '@/lib/locale-context';
import { isDepotOperator, isDepotResolvedRole } from '@/lib/roles';

// Screens that read `selectedId` themselves and genuinely answer for "all depots". Every
// other console screen asks `scopedId`, which falls back to the FIRST depot when "Semua
// depot" is chosen — so it quietly showed one depot's numbers under a switcher that said
// "all". Say so out loud instead of leaving the person to infer it.
const ALL_AWARE = [
  '/dashboard/orders',
  '/dashboard/churn',
  '/dashboard/promo-rules',
  '/dashboard/sales-import',
  '/dashboard/customers/import',
  '/dashboard/inventory/import',
  '/dashboard/pricing/import',
  '/dashboard/resellers/import',
  '/dashboard/returns/import',
];

export function AllDepotsNotice() {
  const { t } = useT();
  const pathname = usePathname() ?? '';
  const { selectedId, depots, ready } = useDepot();

  if (!ready || selectedId !== null || depots.length < 2) return null;
  if (ALL_AWARE.some((p) => pathname.startsWith(p))) return null;

  return (
    <div
      role="status"
      className="mb-4 flex items-start gap-2 rounded-xl border border-app bg-[color:var(--surface-soft)] px-3 py-2.5 text-[12.5px] font-medium text-[color:var(--text-muted)]"
    >
      <Buildings size={16} weight="fill" className="mt-0.5 shrink-0 text-brand-600" />
      <span>{t('ops.switcher.perDepotNotice', { name: depots[0]?.name ?? '' })}</span>
    </div>
  );
}

/**
 * An account whose depot list came back EMPTY, said once for every screen under it.
 *
 * A manager with no placement depot and no supervision chain opened the phone console and
 * every tab was blank: the home, approvals, team and pricing all read `scopedId`, which is
 * null, so each one quietly asked nothing. The few screens that did say something said
 * "Belum ada depot yang dikonfigurasi", which is false here: the network has depots, this
 * account is simply not linked to any. The fix is data (Hierarki, or a placement depot),
 * so the screen names where to make it.
 *
 * Only for roles whose depots come from a link: supervision (MANAGER, SUPERVISOR, ASISTEN
 * SPV), ownership (FRANCHISE_OWNER) or placement (KEPALA_DEPOT). An unscoped role with an
 * empty list really is looking at a network with no depots, and the pages already say so.
 * A failed read is not "no depots" either; that error is shown where the list is used.
 */
/** `className` places it in a shell with no padding of its own (the manager phone shell). */
export function NoDepotScopeNotice({ className = '' }: { className?: string }) {
  const { t } = useT();
  const { customer } = useAuth();
  const { depots, ready, error } = useDepot();
  const role = customer?.role;

  if (!ready || error || depots.length > 0) return null;
  const owner = role === 'FRANCHISE_OWNER';
  if (!owner && !isDepotResolvedRole(role) && !isDepotOperator(role)) return null;

  return (
    <div
      role="alert"
      className={`mb-4 flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-[12.5px] font-medium text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100 ${className}`}
    >
      <LinkBreak size={16} weight="fill" className="mt-0.5 shrink-0" />
      <span>
        <strong className="block">{t('ops.switcher.noScopeTitle')}</strong>
        {t(owner ? 'ops.switcher.noScopeOwner' : 'ops.switcher.noScopeBody')}
      </span>
    </div>
  );
}
