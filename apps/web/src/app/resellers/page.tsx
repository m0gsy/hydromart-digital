'use client';

import { useMemo, useState } from 'react';

import {
  Badge,
  Button,
  Card,
  ErrorState,
  Field,
  Input,
  LinkButton,
  SectionHeader,
  Skeleton,
} from '@/components/ui';
import { useToast } from '@/components/toast';
import { useAuth } from '@/lib/auth-context';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { canManageResellers, canViewResellers, isHq } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import {
  evaluateReseller,
  RESELLER_STATUS_LABEL,
  type Reseller,
  type ResellerRollupRow,
} from '@/lib/reseller';
import type { Customer, DepotAdmin, Page } from '@/lib/types';

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

const EMPTY_DEPOTS: Page<DepotAdmin> = { items: [], total: 0, page: 1, limit: 100 };

// Register a customer (by phone) as a reseller for the picked depot. Resolves phone → customerId
// via the same staff-only lookup the voucher-grant panel uses, then POSTs the registry entry.
function RegisterResellerForm({ depotId, onDone }: { depotId: string; onDone: () => void }) {
  const { toast: notify } = useToast();
  const [phone, setPhone] = useState('');
  const [target, setTarget] = useState('');
  const [discount, setDiscount] = useState('');
  const [joinDate, setJoinDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!phone.trim() || !target.trim() || !joinDate) {
      setError('Nomor HP, target bulanan, dan tanggal bergabung wajib diisi.');
      return;
    }
    if (!(Number(target) >= 0)) {
      setError('Target bulanan harus berupa angka 0 atau lebih.');
      return;
    }
    if (discount !== '' && !(Number(discount) >= 0 && Number(discount) <= 100)) {
      setError('Diskon harus 0–100.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const customer = await api.get<Customer>(endpoints.auth.customerLookup(phone.trim()), true);
      await api.post(
        endpoints.resellers.create,
        {
          customerId: customer.id,
          homeDepotId: depotId,
          monthlyTargetQty: Number(target),
          discountPct: Number(discount) || 0,
          joinDate: new Date(joinDate).toISOString(),
        },
        true,
      );
      notify('Reseller ditambahkan');
      setPhone('');
      setTarget('');
      setDiscount('');
      setJoinDate('');
      onDone();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.status === 404
            ? 'Pelanggan dengan nomor itu tidak ditemukan.'
            : err.status === 400
              ? 'Nomor tersebut bukan pelanggan terdaftar.'
              : err.status === 409
                ? 'Pelanggan ini sudah menjadi reseller.'
                : err.message
          : 'Gagal menambahkan reseller.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-4">
      <h2 className="mb-3 font-semibold">Tambah reseller</h2>
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-3">
        <Field label="Nomor HP pelanggan" hint="Format 0812…, +62…, atau 62…">
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="081234567890" />
        </Field>
        <Field label="Target bulanan (galon)">
          <Input type="number" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="100" />
        </Field>
        <Field label="Diskon reseller (%)" hint="0–100, kosong = 0">
          <Input type="number" value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="10" />
        </Field>
        <Field label="Tanggal bergabung">
          <Input type="date" value={joinDate} onChange={(e) => setJoinDate(e.target.value)} />
        </Field>
        {error && <p className="text-sm text-red-600 sm:col-span-3">{error}</p>}
        <div className="sm:col-span-3">
          <Button type="submit" loading={busy}>
            Tambah reseller
          </Button>
        </div>
      </form>
    </Card>
  );
}

// One reseller row: shows target/volume/attainment, plus edit (target+note) and
// activate/deactivate row actions. Mirrors the inline-edit idiom from
// apps/web/src/app/addresses/page.tsx (openEdit/save/cancel local state) but keeps the
// form inline in the row rather than a Sheet — the edited fields are just two inputs.
function ResellerRow({
  reseller: r,
  roll,
  name,
  onChanged,
}: {
  reseller: Reseller;
  roll: ResellerRollupRow | undefined;
  name: string | undefined;
  onChanged: () => void;
}) {
  const { toast: notify } = useToast();
  const [editing, setEditing] = useState(false);
  const [target, setTarget] = useState(String(r.monthlyTargetQty));
  const [discount, setDiscount] = useState(String(r.discountPct));
  const [note, setNote] = useState(r.note ?? '');
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState(false);

  const m = evaluateReseller({
    volumeQty: roll?.volumeQty ?? 0,
    prevVolumeQty: roll?.prevVolumeQty ?? 0,
    monthlyTargetQty: r.monthlyTargetQty,
    lastOrderAt: roll?.lastOrderAt ?? null,
  });

  function openEdit() {
    setTarget(String(r.monthlyTargetQty));
    setDiscount(String(r.discountPct));
    setNote(r.note ?? '');
    setEditing(true);
  }

  async function saveEdit() {
    if (!(Number(target) >= 0)) {
      notify('Target bulanan harus berupa angka 0 atau lebih.', 'error');
      return;
    }
    if (!(Number(discount) >= 0 && Number(discount) <= 100)) {
      notify('Diskon harus 0–100.', 'error');
      return;
    }
    setSaving(true);
    try {
      await api.patch(
        endpoints.resellers.detail(r.customerId),
        { monthlyTargetQty: Number(target), discountPct: Number(discount), note: note.trim() || null },
        true,
      );
      notify('Reseller diperbarui');
      setEditing(false);
      onChanged();
    } catch (err) {
      notify(err instanceof ApiError ? err.message : 'Gagal memperbarui reseller.', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive() {
    setToggling(true);
    try {
      await api.patch(endpoints.resellers.detail(r.customerId), { active: !r.active }, true);
      notify(r.active ? 'Reseller dinonaktifkan' : 'Reseller diaktifkan kembali');
      onChanged();
    } catch (err) {
      notify(err instanceof ApiError ? err.message : 'Gagal mengubah status reseller.', 'error');
    } finally {
      setToggling(false);
    }
  }

  if (editing) {
    return (
      <div className="p-4 text-sm">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Target bulanan (galon)">
            <Input type="number" value={target} onChange={(e) => setTarget(e.target.value)} />
          </Field>
          <Field label="Diskon (%)">
            <Input type="number" value={discount} onChange={(e) => setDiscount(e.target.value)} />
          </Field>
          <Field label="Catatan (opsional)">
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
        <div className="mt-3 flex gap-2">
          <Button type="button" loading={saving} onClick={saveEdit}>
            Simpan
          </Button>
          <Button type="button" variant="secondary" disabled={saving} onClick={() => setEditing(false)}>
            Batal
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex items-center justify-between gap-4 p-4 text-sm ${r.active ? '' : 'opacity-60'}`}>
      <div>
        <div className="font-semibold">{name ?? r.customerId}</div>
        <div className="text-muted">
          {roll?.volumeQty ?? 0} / {r.monthlyTargetQty} galon
          {m.attainmentPct != null && <> · {m.attainmentPct}%</>}
          {' · '}pertumbuhan {m.growthPct >= 0 ? '↑' : '↓'} {Math.abs(m.growthPct)}%
          {r.discountPct > 0 && <> · diskon {r.discountPct}%</>}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {!r.active && <Badge tone="neutral">Nonaktif</Badge>}
        {r.active && m.pasif && <Badge tone="danger">Pasif</Badge>}
        <Badge
          tone={
            m.status === 'lampaui' || m.status === 'tercapai'
              ? 'success'
              : m.status === 'no-target'
                ? 'neutral'
                : 'danger'
          }
        >
          {RESELLER_STATUS_LABEL[m.status]}
        </Badge>
        <Button type="button" variant="secondary" onClick={openEdit} className="px-3 py-1.5 text-xs">
          Ubah
        </Button>
        <Button
          type="button"
          variant={r.active ? 'danger' : 'secondary'}
          loading={toggling}
          onClick={toggleActive}
          className="px-3 py-1.5 text-xs"
        >
          {r.active ? 'Nonaktifkan' : 'Aktifkan'}
        </Button>
      </div>
    </div>
  );
}

// Reseller (agen) achievement console — joins the reseller registry (target) with the
// order-service rollup (actual volume/growth) for one depot + month. HQ picks the depot
// via a select; a depot manager is pinned to their own (customer.assignedDepotId).
export default function ResellersPage() {
  const { customer } = useAuth();
  const canView = canViewResellers(customer?.role);
  const hq = isHq(customer?.role);
  const month = useMemo(currentMonth, []);

  const [pickedDepotId, setPickedDepotId] = useState('');
  const depotId = hq ? pickedDepotId : (customer?.assignedDepotId ?? '');

  const depotList = useAsync<Page<DepotAdmin>>(
    () => (hq ? api.get<Page<DepotAdmin>>(endpoints.depots.manage({ limit: 100 }), true) : Promise.resolve(EMPTY_DEPOTS)),
    [hq],
  );

  const registry = useAsync<Reseller[]>(
    () => (depotId ? api.get<Reseller[]>(endpoints.resellers.list({ depotId }), true) : Promise.resolve([])),
    [depotId],
  );

  const ids = useMemo(() => (registry.data ?? []).map((r) => r.customerId), [registry.data]);
  const rollup = useAsync<{ rows: ResellerRollupRow[] }>(
    () =>
      ids.length && depotId
        ? api.get(endpoints.reports.resellerRollup({ depotId, month, customerIds: ids }), true)
        : Promise.resolve({ rows: [] }),
    [depotId, month, ids.join(',')],
  );

  // Resolve reseller ids → names for the row labels (auth-service owns the customer name).
  const names = useAsync<Customer[]>(
    () => (ids.length ? api.get<Customer[]>(endpoints.auth.customersByIds(ids), true) : Promise.resolve([])),
    [ids.join(',')],
  );

  if (!canView) {
    return (
      <div className="mx-auto max-w-4xl">
        <ErrorState message="Akses ditolak" />
      </div>
    );
  }

  const byId = new Map((rollup.data?.rows ?? []).map((r) => [r.customerId, r]));
  const nameById = new Map(
    (names.data ?? []).map((c) => [c.id, c.fullName?.trim() || c.phone] as const),
  );

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <SectionHeader
        title="Reseller (Agen)"
        subtitle={`Pencapaian ${month}`}
        action={
          canManageResellers(customer?.role) ? (
            <LinkButton href="/dashboard/resellers/import" variant="secondary">
              Import Excel
            </LinkButton>
          ) : undefined
        }
      />

      {hq && (
        <Card className="p-4">
          <label className="mb-1.5 block text-sm font-medium" htmlFor="reseller-depot">
            Depot
          </label>
          <select
            id="reseller-depot"
            value={pickedDepotId}
            onChange={(e) => setPickedDepotId(e.target.value)}
            className="surface-elevated w-full max-w-xs rounded-lg border border-app px-3.5 py-2.5 text-sm focus:outline focus:outline-2 focus:outline-offset-0 focus:outline-brand-600"
          >
            <option value="">Pilih depot…</option>
            {(depotList.data?.items ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </Card>
      )}

      {depotId && <RegisterResellerForm depotId={depotId} onDone={registry.reload} />}

      {registry.loading && depotId && <Skeleton className="h-64" />}
      {registry.error && <ErrorState message={registry.error} onRetry={registry.reload} />}
      {rollup.error && <ErrorState message={rollup.error} onRetry={rollup.reload} />}
      {!depotId && !registry.loading && (
        <p className="text-sm text-muted">
          {hq ? 'Pilih depot untuk melihat reseller.' : 'Depot belum ditentukan.'}
        </p>
      )}
      {registry.data && registry.data.length === 0 && depotId && (
        <p className="text-sm text-muted">Belum ada reseller di depot ini.</p>
      )}
      {registry.data && registry.data.length > 0 && (
        <Card className="divide-y divide-[color:var(--border)] p-0">
          {registry.data.map((r) => (
            <ResellerRow
              key={r.customerId}
              reseller={r}
              roll={byId.get(r.customerId)}
              name={nameById.get(r.customerId)}
              onChanged={registry.reload}
            />
          ))}
        </Card>
      )}
    </div>
  );
}
