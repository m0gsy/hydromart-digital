'use client';

import { useDepot } from '@/lib/depot-context';

/**
 * Depot chooser for the two depot-scoped HR reads (pelanggan, reseller).
 *
 * The HR rail deliberately has no global depot switcher — HR is network-wide — but those
 * two pages read a per-depot CRM endpoint, so without a picker they were pinned to
 * whichever depot `scopedId` fell back to (the first one) with no way to move.
 *
 * One depot at a time, not "Semua depot": the endpoints behind these pages take a depotId
 * and have no aggregate form, so offering it would just show an empty table.
 * Hidden when there is nothing to choose between.
 */
export function HrDepotPicker() {
  const { depots, scopedId, setSelected } = useDepot();

  if (depots.length <= 1) return null;

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-muted">Depot</span>
      <select
        value={scopedId ?? ''}
        onChange={(e) => setSelected(e.target.value)}
        aria-label="Pilih depot"
        className="surface-elevated rounded-lg border border-app px-3 py-2 text-sm focus:outline focus:outline-2 focus:outline-brand-600"
      >
        {depots.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name} · {d.code}
          </option>
        ))}
      </select>
    </label>
  );
}
