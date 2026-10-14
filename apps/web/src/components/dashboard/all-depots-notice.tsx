'use client';

import { Buildings } from '@phosphor-icons/react';
import { usePathname } from 'next/navigation';

import { useDepot } from '@/lib/depot-context';
import { useT } from '@/lib/locale-context';

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
