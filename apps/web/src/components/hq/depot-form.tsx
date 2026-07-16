'use client';

import { useState } from 'react';
import { Buildings, Storefront } from '@phosphor-icons/react';

import { Button, Card, Field, Input, RadioCard } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { EMPTY_DEPOT_FORM, toDepotPayload, type DepotForm } from '@/lib/depots';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import type { DepotAdmin } from '@/lib/types';

function formFromDepot(d: DepotAdmin): DepotForm {
  return {
    code: d.code,
    name: d.name,
    ownershipType: d.ownershipType,
    address: d.address,
    city: d.city,
    province: d.province,
    lat: String(d.lat),
    lng: String(d.lng),
    serviceRadiusKm: String(d.serviceRadiusKm),
    deliveryFee: String(d.deliveryFee),
    minOrderAmount: d.minOrderAmount == null ? '' : String(d.minOrderAmount),
    paymentBankName: d.paymentBankName ?? '',
    paymentBankAccountNumber: d.paymentBankAccountNumber ?? '',
    paymentBankAccountHolder: d.paymentBankAccountHolder ?? '',
    paymentQrisImageUrl: d.paymentQrisImageUrl ?? '',
  };
}

// Design 3b — HQ depot onboarding/edit form. Reuses the shared DepotForm validation
// (EMPTY_DEPOT_FORM / toDepotPayload) and the same create/detail endpoints as the ops
// depot console; only the presentation (RadioCard ownership) differs.
export function DepotForm({
  depot,
  onDone,
  onCancel,
}: {
  depot: DepotAdmin | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { t } = useT();
  const [form, setForm] = useState<DepotForm>(depot ? formFromDepot(depot) : EMPTY_DEPOT_FORM);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof DepotForm) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  const setOwnership = (v: string) => setForm((f) => ({ ...f, ownershipType: v }));

  async function submit() {
    const parsed = toDepotPayload(form);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (depot) await api.patch(endpoints.depots.detail(depot.id), parsed.value, true);
      else await api.post(endpoints.depots.create, parsed.value, true);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('hq.depots.form.saveError'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4 p-5">
      <h2 className="text-lg font-bold">
        {depot ? t('hq.depots.form.titleEdit', { name: depot.name }) : t('hq.depots.form.titleNew')}
      </h2>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('hq.depots.form.code')} htmlFor="d-code">
          <Input id="d-code" value={form.code} onChange={set('code')} placeholder="JKT-01" />
        </Field>
        <Field label={t('hq.depots.form.name')} htmlFor="d-name">
          <Input id="d-name" value={form.name} onChange={set('name')} placeholder="Depot Cikini" />
        </Field>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">{t('hq.depots.form.ownership')}</span>
        <div className="grid gap-3 sm:grid-cols-2">
          <RadioCard selected={form.ownershipType === 'HKP'} onSelect={() => setOwnership('HKP')}>
            <Buildings size={22} weight="fill" className="text-brand-600" />
            <span className="text-sm font-semibold">{t('hq.depots.form.central')}</span>
          </RadioCard>
          <RadioCard
            selected={form.ownershipType === 'WARALABA'}
            onSelect={() => setOwnership('WARALABA')}
          >
            <Storefront size={22} weight="fill" className="text-brand-600" />
            <span className="text-sm font-semibold">{t('hq.depots.form.franchise')}</span>
          </RadioCard>
        </div>
      </div>

      <Field label={t('hq.depots.form.address')} htmlFor="d-addr">
        <Input id="d-addr" value={form.address} onChange={set('address')} placeholder="Jl. Cikini Raya No. 1" />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('hq.depots.form.city')} htmlFor="d-city">
          <Input id="d-city" value={form.city} onChange={set('city')} placeholder="Jakarta Pusat" />
        </Field>
        <Field label={t('hq.depots.form.province')} htmlFor="d-prov">
          <Input id="d-prov" value={form.province} onChange={set('province')} placeholder="DKI Jakarta" />
        </Field>
        <Field label={t('hq.depots.form.lat')} htmlFor="d-lat">
          <Input id="d-lat" inputMode="decimal" value={form.lat} onChange={set('lat')} placeholder="-6.1944" />
        </Field>
        <Field label={t('hq.depots.form.lng')} htmlFor="d-lng">
          <Input id="d-lng" inputMode="decimal" value={form.lng} onChange={set('lng')} placeholder="106.8412" />
        </Field>
        <Field label={t('hq.depots.form.radius')} htmlFor="d-rad" hint={t('hq.depots.form.radiusHint')}>
          <Input id="d-rad" inputMode="decimal" value={form.serviceRadiusKm} onChange={set('serviceRadiusKm')} placeholder="5" />
        </Field>
        <Field label={t('hq.depots.form.fee')} htmlFor="d-fee">
          <Input id="d-fee" inputMode="numeric" value={form.deliveryFee} onChange={set('deliveryFee')} placeholder="5000" />
        </Field>
        <Field label={t('hq.depots.form.minOrder')} htmlFor="d-min" hint={t('hq.depots.form.minOrderHint')}>
          <Input id="d-min" inputMode="numeric" value={form.minOrderAmount} onChange={set('minOrderAmount')} placeholder="20000" />
        </Field>
      </div>

      {error && (
        <p className="text-sm font-medium text-red-600" role="alert">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          {t('hq.depots.form.cancel')}
        </Button>
        <Button onClick={submit} loading={busy}>
          {depot ? t('hq.depots.form.save') : t('hq.depots.form.create')}
        </Button>
      </div>
    </Card>
  );
}
