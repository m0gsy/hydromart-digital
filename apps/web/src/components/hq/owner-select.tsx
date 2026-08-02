'use client';

import { Field } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import type { Customer, Page } from '@/lib/types';

const selectClass =
  'surface-elevated w-full rounded-lg border border-app px-3.5 py-2.5 text-sm focus:outline focus:outline-2 focus:outline-brand-600';

/**
 * Picks the FRANCHISE_OWNER account a WARALABA depot belongs to. Shared by the HQ onboard
 * form and the ops depot console because both POST the same depot payload — a depot created
 * from either one without an owner has its revenue booked to nobody (see toDepotPayload).
 */
export function OwnerSelect({
  value,
  onChange,
  id = 'd-owner',
}: {
  value: string;
  onChange: (e: { target: { value: string } }) => void;
  id?: string;
}) {
  const { t } = useT();
  const owners = useAsync<Page<Customer>>(() =>
    api.get(endpoints.auth.staff({ role: 'FRANCHISE_OWNER', limit: 100 }), true),
  );
  const options = owners.data?.items ?? [];
  const hint = owners.error
    ? t('hq.depots.form.ownerLoadError')
    : !owners.loading && options.length === 0
      ? t('hq.depots.form.ownerEmpty')
      : t('hq.depots.form.ownerHint');

  return (
    <Field label={t('hq.depots.form.owner')} htmlFor={id} hint={hint}>
      <select id={id} value={value} onChange={onChange} className={selectClass}>
        <option value="">{t('hq.depots.form.ownerPick')}</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.fullName || o.phone}
          </option>
        ))}
      </select>
    </Field>
  );
}
