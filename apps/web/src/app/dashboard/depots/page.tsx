'use client';

import { useRef, useState } from 'react';
import { Bank, Buildings, Clock, Lock, Money as MoneyIcon, QrCode } from '@phosphor-icons/react';

import { DepotHoursEditor } from '@/components/dashboard/depot-hours-editor';
import { DepotDetail } from '@/components/dashboard/depot-detail';
import { DepotMap } from '@/components/dashboard/depot-map';
import { RequireAuth } from '@/components/require-auth';
import { Badge, Button, Card, CenterState, ErrorState, Field, Input, Money, Skeleton } from '@/components/ui';
import { api, ApiError, uploadFile } from '@/lib/api';
import { EMPTY_DEPOT_FORM, toDepotPayload, type DepotForm } from '@/lib/depots';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import { useT } from '@/lib/locale-context';
import { canManageDepots } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import type { DepotAdmin, Page } from '@/lib/types';

const inputClass =
  'surface-elevated w-full rounded-lg border border-app px-3.5 py-2.5 text-sm placeholder:text-[color:var(--text-muted)] focus:outline focus:outline-2 focus:outline-brand-600';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080';
const QRIS_MAX_BYTES = 5 * 1024 * 1024;

/** 4b — static-QRIS image uploader (replaces the old raw-URL text field). Upload is immediate
 *  and independent of the form save; it needs a persisted depot, so create-mode shows a hint. */
function QrisUploader({
  depot,
  qrisUrl,
  onUploaded,
}: {
  depot: DepotAdmin | null;
  qrisUrl: string;
  onUploaded: (url: string) => void;
}) {
  const { t } = useT();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !depot) return;
    if (file.size > QRIS_MAX_BYTES) {
      setError(t('opsFix.qris.tooLarge'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const updated = await uploadFile<DepotAdmin>(endpoints.depots.uploadQris(depot.id), file);
      onUploaded(updated.paymentQrisImageUrl ?? '');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('opsFix.qris.uploadError'));
    } finally {
      setBusy(false);
    }
  }

  const src = qrisUrl ? (qrisUrl.startsWith('http') ? qrisUrl : `${BASE_URL}${qrisUrl}`) : null;

  return (
    <div className="border-t border-app pt-3">
      <div className="mb-1 flex items-center gap-2">
        <QrCode size={18} weight="fill" className="text-brand-500" />
        <p className="text-sm font-semibold">{t('opsFix.qris.heading')}</p>
      </div>
      <p className="mb-3 text-xs text-muted">{t('opsFix.qris.hint')}</p>
      {src ? (
        <img src={src} alt={t('opsFix.qris.alt')} className="mx-auto h-40 w-40 rounded-lg border border-app object-contain" />
      ) : (
        <div className="mx-auto flex h-40 w-40 items-center justify-center rounded-lg border border-dashed border-app text-xs text-muted">
          {t('opsFix.qris.none')}
        </div>
      )}
      {error && (
        <p className="mt-2 text-sm font-medium text-red-600" role="alert">
          {error}
        </p>
      )}
      {depot ? (
        <>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={onPick} />
          <Button variant="secondary" className="mt-3 w-full" onClick={() => fileRef.current?.click()} loading={busy}>
            {qrisUrl ? t('opsFix.qris.replace') : t('opsFix.qris.upload')}
          </Button>
        </>
      ) : (
        <p className="mt-3 rounded-lg bg-[color:var(--surface-soft)] px-3 py-2 text-center text-xs text-muted">
          {t('opsFix.qris.uploadAfterSave')}
        </p>
      )}
    </div>
  );
}

/** 4b — accepted payment methods. There is no per-method enable flag in the depot schema
 *  (money goes direct to each depot), so enablement is derived from what is configured. */
function MethodsPreview({ form }: { form: DepotForm }) {
  const { t } = useT();
  const rows: { icon: React.ReactNode; title: string; desc: string; active: boolean }[] = [
    { icon: <MoneyIcon size={18} weight="fill" />, title: t('opsFix.qris.cod'), desc: t('opsFix.qris.codDesc'), active: true },
    { icon: <QrCode size={18} weight="fill" />, title: t('opsFix.qris.qris'), desc: t('opsFix.qris.qrisDesc'), active: !!form.paymentQrisImageUrl },
    { icon: <Bank size={18} weight="fill" />, title: t('opsFix.qris.transfer'), desc: t('opsFix.qris.transferDesc'), active: !!form.paymentBankAccountNumber.trim() },
  ];
  return (
    <div className="border-t border-app pt-3">
      <p className="mb-2 text-sm font-semibold">{t('opsFix.qris.methodsTitle')}</p>
      <div className="flex flex-col">
        {rows.map((r) => (
          <div key={r.title} className="flex items-center gap-3 border-t border-app py-2.5 first:border-0 first:pt-0">
            <span className="text-brand-500">{r.icon}</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{r.title}</p>
              <p className="text-xs text-muted">{r.desc}</p>
            </div>
            <Badge tone={r.active ? 'success' : 'neutral'}>{r.active ? t('opsFix.qris.active') : t('opsFix.qris.notSet')}</Badge>
          </div>
        ))}
      </div>
    </div>
  );
}

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

/** Create (depot=null) or edit form. Hours/holidays are omitted — see page ceiling note. */
function DepotEditor({ depot, onDone, onCancel }: { depot: DepotAdmin | null; onDone: () => void; onCancel: () => void }) {
  const { t } = useT();
  const [form, setForm] = useState<DepotForm>(depot ? formFromDepot(depot) : EMPTY_DEPOT_FORM);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof DepotForm) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

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
      setError(err instanceof ApiError ? err.message : t('dashboard.depots.saveError'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4 p-5">
      <h2 className="font-semibold">{depot ? `${t('dashboard.depots.editPrefix')}${depot.name}` : t('dashboard.depots.newTitle')}</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('dashboard.depots.code')} htmlFor="d-code">
          <Input id="d-code" value={form.code} onChange={set('code')} placeholder="JKT-01" />
        </Field>
        <Field label={t('dashboard.depots.name')} htmlFor="d-name">
          <Input id="d-name" value={form.name} onChange={set('name')} placeholder="Depot Cikini" />
        </Field>
        <Field label={t('dashboard.depots.ownership')} htmlFor="d-own">
          <select id="d-own" value={form.ownershipType} onChange={set('ownershipType')} className={inputClass}>
            <option value="HKP">HKP</option>
            <option value="WARALABA">WARALABA</option>
          </select>
        </Field>
        <Field label={t('dashboard.depots.city')} htmlFor="d-city">
          <Input id="d-city" value={form.city} onChange={set('city')} placeholder="Jakarta Pusat" />
        </Field>
        <Field label={t('dashboard.depots.province')} htmlFor="d-prov">
          <Input id="d-prov" value={form.province} onChange={set('province')} placeholder="DKI Jakarta" />
        </Field>
        <Field label={t('dashboard.depots.address')} htmlFor="d-addr">
          <Input id="d-addr" value={form.address} onChange={set('address')} placeholder="Jl. Cikini Raya No. 1" />
        </Field>
        <Field label={t('dashboard.depots.latitude')} htmlFor="d-lat">
          <Input id="d-lat" inputMode="decimal" value={form.lat} onChange={set('lat')} placeholder="-6.1944" />
        </Field>
        <Field label={t('dashboard.depots.longitude')} htmlFor="d-lng">
          <Input id="d-lng" inputMode="decimal" value={form.lng} onChange={set('lng')} placeholder="106.8412" />
        </Field>
        <Field label={t('dashboard.depots.serviceRadius')} htmlFor="d-rad" hint={t('dashboard.depots.serviceRadiusHint')}>
          <Input id="d-rad" inputMode="decimal" value={form.serviceRadiusKm} onChange={set('serviceRadiusKm')} placeholder="5" />
        </Field>
        <Field label={t('dashboard.depots.deliveryFee')} htmlFor="d-fee">
          <Input id="d-fee" inputMode="numeric" value={form.deliveryFee} onChange={set('deliveryFee')} placeholder="5000" />
        </Field>
        <Field label={t('dashboard.depots.minOrder')} htmlFor="d-min" hint={t('dashboard.depots.minOrderHint')}>
          <Input id="d-min" inputMode="numeric" value={form.minOrderAmount} onChange={set('minOrderAmount')} placeholder="20000" />
        </Field>
      </div>

      <div className="border-t border-app pt-3">
        <p className="mb-1 text-sm font-semibold">Info pembayaran depot</p>
        <p className="mb-3 text-xs text-muted">
          Ditampilkan ke pelanggan saat bayar transfer/QRIS. Uang masuk langsung ke depot; staf konfirmasi manual.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nama bank" htmlFor="d-bank" hint="mis. BCA">
            <Input id="d-bank" value={form.paymentBankName} onChange={set('paymentBankName')} placeholder="BCA" />
          </Field>
          <Field label="Nomor rekening" htmlFor="d-acc">
            <Input id="d-acc" inputMode="numeric" value={form.paymentBankAccountNumber} onChange={set('paymentBankAccountNumber')} placeholder="1234567890" />
          </Field>
          <Field label="Atas nama" htmlFor="d-holder">
            <Input id="d-holder" value={form.paymentBankAccountHolder} onChange={set('paymentBankAccountHolder')} placeholder="Depot Cikini" />
          </Field>
        </div>
        <QrisUploader
          depot={depot}
          qrisUrl={form.paymentQrisImageUrl}
          onUploaded={(url) => setForm((f) => ({ ...f, paymentQrisImageUrl: url }))}
        />
        <MethodsPreview form={form} />
      </div>
      {error && (
        <p className="text-sm font-medium text-red-600" role="alert">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          {t('dashboard.depots.cancel')}
        </Button>
        <Button onClick={submit} loading={busy}>
          {depot ? t('dashboard.depots.saveChanges') : t('dashboard.depots.createDepot')}
        </Button>
      </div>
    </Card>
  );
}

function DepotCard({
  depot,
  onEdit,
  onHours,
  onDetail,
  onChanged,
}: {
  depot: DepotAdmin;
  onEdit: () => void;
  onHours: () => void;
  onDetail: () => void;
  onChanged: () => void;
}) {
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggleActive() {
    setBusy(true);
    setError(null);
    try {
      if (depot.active) await api.del(endpoints.depots.detail(depot.id), true);
      else await api.patch(endpoints.depots.detail(depot.id), { active: true }, true);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('dashboard.depots.updateError'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold">{depot.name}</p>
          <p className="text-xs text-muted">
            {depot.code} · {depot.city} · {depot.ownershipType}
          </p>
        </div>
        <Badge tone={depot.active ? 'success' : 'neutral'}>{depot.active ? t('dashboard.depots.active') : t('dashboard.depots.inactive')}</Badge>
      </div>
      <dl className="grid grid-cols-3 gap-2 text-center text-sm">
        <div>
          <dt className="text-xs text-muted">{t('dashboard.depots.radius')}</dt>
          <dd className="font-semibold tabular-nums">{depot.serviceRadiusKm} km</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">{t('dashboard.depots.delivery')}</dt>
          <dd className="font-semibold"><Money amount={depot.deliveryFee} /></dd>
        </div>
        <div>
          <dt className="text-xs text-muted">{t('dashboard.depots.minOrderShort')}</dt>
          <dd className="font-semibold">{depot.minOrderAmount == null ? '—' : <Money amount={depot.minOrderAmount} />}</dd>
        </div>
      </dl>
      {error && (
        <p className="text-sm font-medium text-red-600" role="alert">
          {error}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2 border-t border-app pt-2">
        <Button variant="ghost" onClick={onDetail} disabled={busy}>
          {t('dashboard.depots.detail')}
        </Button>
        <Button variant="ghost" onClick={onHours} disabled={busy}>
          <Clock size={16} weight="fill" />
          {t('dashboard.depots.hours')}
        </Button>
        <Button variant="secondary" onClick={onEdit} disabled={busy}>
          {t('dashboard.depots.edit')}
        </Button>
        <Button variant={depot.active ? 'danger' : 'primary'} onClick={toggleActive} loading={busy}>
          {depot.active ? t('dashboard.depots.deactivate') : t('dashboard.depots.reactivate')}
        </Button>
      </div>
    </Card>
  );
}

function DepotsBody() {
  const { t } = useT();
  const [editing, setEditing] = useState<DepotAdmin | null | 'new'>(null);
  const [hoursDepot, setHoursDepot] = useState<DepotAdmin | null>(null);
  const [detail, setDetail] = useState<DepotAdmin | null>(null);
  const [view, setView] = useState<'list' | 'map'>('list');
  const list = useAsync<Page<DepotAdmin>>(() => api.get(endpoints.depots.manage({ limit: 100 }), true));
  const items = list.data?.items ?? [];

  function closeForm() {
    setEditing(null);
    list.reload();
  }
  function closeHours() {
    setHoursDepot(null);
    list.reload();
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Buildings size={24} weight="fill" className="text-brand-500" />
          <h1 className="text-2xl font-bold">{t('dashboard.depots.title')}</h1>
        </div>
        <div className="flex gap-2">
          <div className="flex overflow-hidden rounded-full border border-app text-sm font-semibold">
            {(['list', 'map'] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={`px-3 py-1.5 transition-colors ${
                  view === v ? 'bg-brand-600 text-on-brand' : 'surface-elevated hover:bg-brand-50'
                }`}
              >
                {v === 'list' ? t('dashboard.depots.list') : t('dashboard.depots.map')}
              </button>
            ))}
          </div>
          {editing === null && <Button onClick={() => setEditing('new')}>{t('dashboard.depots.newDepot')}</Button>}
        </div>
      </div>

      {editing !== null && (
        <DepotEditor
          key={editing === 'new' ? 'new' : editing.id}
          depot={editing === 'new' ? null : editing}
          onDone={closeForm}
          onCancel={() => setEditing(null)}
        />
      )}

      {hoursDepot && (
        <DepotHoursEditor
          key={`hours-${hoursDepot.id}`}
          depot={hoursDepot}
          onDone={closeHours}
          onCancel={() => setHoursDepot(null)}
        />
      )}

      {list.loading ? (
        <Skeleton className="h-64 w-full" />
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : items.length === 0 ? (
        <CenterState title={t('dashboard.depots.noDepots')} icon={<Buildings size={40} weight="fill" />}>
          {t('dashboard.depots.noDepotsBody')}
        </CenterState>
      ) : view === 'map' ? (
        <DepotMap depots={items} onSelect={setDetail} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {items.map((d) => (
            <DepotCard
              key={d.id}
              depot={d}
              onEdit={() => setEditing(d)}
              onHours={() => setHoursDepot(d)}
              onDetail={() => setDetail(d)}
              onChanged={list.reload}
            />
          ))}
        </div>
      )}

      {detail && <DepotDetail depot={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

function Gate() {
  const { t } = useT();
  const { customer } = useAuth();
  if (!canManageDepots(customer?.role)) {
    return (
      <CenterState title={t('dashboard.depots.gateTitle')} icon={<Lock size={40} weight="fill" />}>
        {t('dashboard.depots.gateBody')}
      </CenterState>
    );
  }
  return <DepotsBody />;
}

export default function DepotsPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
