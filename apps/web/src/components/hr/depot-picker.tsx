'use client';

import { useDepot } from '@/lib/depot-context';
import { useT } from '@/lib/locale-context';

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
/**
 * G-1: `value`/`onChange` make this a controlled FORM field as well as a page switcher.
 * `/hr/settings` had a `placeholder={t('hrFix.depotPicker.hint')}` text box for the same choice, next to a
 * depot list this component already holds. Uncontrolled (no props) it behaves exactly as
 * before — the pages that switch scope are untouched.
 */
export function HrDepotPicker({
  value,
  onChange,
  label,
  includeEmpty,
}: {
  value?: string;
  onChange?: (depotId: string) => void;
  label?: string;
  /** Offer a blank option — for a form field that may legitimately be left unset. */
  includeEmpty?: string;
} = {}) {
  const { t } = useT();
  const { depots, scopedId, setSelected } = useDepot();
  const controlled = onChange != null;

  // Uncontrolled, this is a switcher between depots — with one depot there is nothing to
  // switch. Controlled, it is a field, and a field with one option still has to render.
  if (!controlled && depots.length <= 1) return null;

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-muted">{label ?? t('hrFix.depotPicker.depot')}</span>
      <select
        value={controlled ? (value ?? '') : (scopedId ?? '')}
        onChange={(e) => (controlled ? onChange(e.target.value) : setSelected(e.target.value))}
        aria-label={t('hrFix.depotPicker.aria')}
        className="surface-elevated rounded-lg border border-app px-3 py-2 text-sm focus:outline focus:outline-2 focus:outline-brand-600"
      >
        {includeEmpty !== undefined && <option value="">{includeEmpty}</option>}
        {depots.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name} · {d.code}
          </option>
        ))}
      </select>
    </label>
  );
}
