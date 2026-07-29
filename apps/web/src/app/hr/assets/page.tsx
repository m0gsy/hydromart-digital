'use client';

import { useState } from 'react';

import { useToast } from '@/components/toast';
import {
  Badge,
  Button,
  Card,
  ErrorState,
  Field,
  Input,
  Money,
  SectionHeader,
  Skeleton,
} from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { endpoints } from '@/lib/endpoints';
import {
  ASSET_MOVEMENT_LABEL,
  ASSET_STATUS_LABEL,
  ASSET_TYPES,
  ASSET_TYPE_LABEL,
  assetMoveNeedsRecipient,
  assetMovesFrom,
  fmtDate,
  type AssetDetail,
  type AssetMovementKind,
  type AssetStatus,
  type AssetType,
  type Employee,
  type EmployeeAsset,
} from '@/lib/hr';
import { canManageHr } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';

const STATUSES: AssetStatus[] = ['AVAILABLE', 'ASSIGNED', 'RETURNED', 'MAINTENANCE', 'LOST'];

const STATUS_TONE: Record<AssetStatus, 'success' | 'warning' | 'neutral' | 'danger'> = {
  AVAILABLE: 'success',
  ASSIGNED: 'warning',
  RETURNED: 'neutral',
  MAINTENANCE: 'warning',
  LOST: 'danger',
};

export default function AssetsPage() {
  const { customer } = useAuth();
  const { depots } = useDepot();
  const { toast } = useToast();
  const isAdmin = canManageHr(customer?.role);

  const [status, setStatus] = useState<'' | AssetStatus>('');
  const [type, setType] = useState<'' | AssetType>('');
  const [open, setOpen] = useState<string | null>(null);

  const assets = useAsync<{ rows: EmployeeAsset[]; total: number }>(
    () =>
      api.get<{ rows: EmployeeAsset[]; total: number }>(
        endpoints.hr.assets({
          ...(status ? { status } : {}),
          ...(type ? { type } : {}),
          pageSize: 100,
        }),
        true,
      ),
    [status, type],
  );
  // Only used to name a holder and to fill the recipient picker — the roster is small.
  const employees = useAsync<{ rows: Employee[] }>(
    () =>
      api.get<{ rows: Employee[] }>(
        endpoints.hr.employees({ status: 'ACTIVE', pageSize: 100 }),
        true,
      ),
    [],
  );

  const staff = employees.data?.rows ?? [];
  const nameOf = (id: string | null) =>
    staff.find((e) => e.id === id)?.fullName ?? (id ? 'karyawan' : '—');
  const depotName = (id: string) => depots.find((d) => d.id === id)?.code ?? 'depot';

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <SectionHeader
        title="Aset"
        subtitle="Barang perusahaan yang dipegang karyawan. Riwayat serah terima tidak pernah dihapus."
      />

      <Card className="space-y-4 p-5">
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-sm">
            Status
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as '' | AssetStatus)}
              className="surface-elevated block rounded-lg border border-app px-3 py-2.5 text-sm"
            >
              <option value="">Semua</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {ASSET_STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Jenis
            <select
              value={type}
              onChange={(e) => setType(e.target.value as '' | AssetType)}
              className="surface-elevated block rounded-lg border border-app px-3 py-2.5 text-sm"
            >
              <option value="">Semua</option>
              {ASSET_TYPES.map((t) => (
                <option key={t} value={t}>
                  {ASSET_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </label>
        </div>

        {assets.loading && <Skeleton className="h-32" />}
        {assets.error && <ErrorState message={assets.error} onRetry={assets.reload} />}
        {assets.data && (
          <ul className="divide-y divide-[color:var(--border)]">
            {assets.data.rows.length === 0 && (
              <li className="py-3 text-sm text-muted">Belum ada aset yang cocok.</li>
            )}
            {assets.data.rows.map((a) => (
              <li key={a.id} className="space-y-2 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <b>{a.code}</b>
                      <Badge tone={STATUS_TONE[a.status]}>{ASSET_STATUS_LABEL[a.status]}</Badge>
                    </div>
                    <p className="text-sm text-muted">
                      {ASSET_TYPE_LABEL[a.type]} · {a.name}
                      {a.brand ? ` · ${a.brand}` : ''}
                      {a.serialNo ? ` · SN ${a.serialNo}` : ''} · {depotName(a.depotId)}
                      {a.status === 'ASSIGNED' ? ` · dipegang ${nameOf(a.holderId)}` : ''}
                    </p>
                    {a.value && (
                      <p className="text-xs text-muted">
                        Nilai <Money amount={Number(a.value)} />
                      </p>
                    )}
                  </div>
                  <Button variant="ghost" onClick={() => setOpen(open === a.id ? null : a.id)}>
                    {open === a.id ? 'Tutup' : 'Riwayat & pergerakan'}
                  </Button>
                </div>
                {open === a.id && (
                  <AssetPanel
                    asset={a}
                    staff={staff}
                    isAdmin={isAdmin}
                    onMoved={() => {
                      assets.reload();
                      toast('Pergerakan aset tercatat');
                    }}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {isAdmin && <NewAsset onCreated={assets.reload} />}
    </div>
  );
}

/** Movement history plus the legal next moves for this asset's current state. */
function AssetPanel({
  asset,
  staff,
  isAdmin,
  onMoved,
}: {
  asset: EmployeeAsset;
  staff: Employee[];
  isAdmin: boolean;
  onMoved: () => void;
}) {
  const { toast } = useToast();
  const detail = useAsync<AssetDetail>(
    () => api.get<AssetDetail>(endpoints.hr.asset(asset.id), true),
    [asset.id, asset.status, asset.holderId],
  );
  const moves = assetMovesFrom(asset.status);
  const [kind, setKind] = useState<AssetMovementKind>(moves[0] ?? 'RETURN');
  const [to, setTo] = useState('');
  const [condition, setCondition] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (assetMoveNeedsRecipient(kind) && !to) {
      toast('Pilih karyawan penerima', 'error');
      return;
    }
    setSaving(true);
    try {
      await api.post(
        endpoints.hr.moveAsset(asset.id),
        {
          kind,
          ...(assetMoveNeedsRecipient(kind) ? { toEmployeeId: to } : {}),
          ...(condition.trim() ? { condition: condition.trim() } : {}),
        },
        true,
      );
      setCondition('');
      setTo('');
      onMoved();
      detail.reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Gagal mencatat pergerakan', 'error');
    } finally {
      setSaving(false);
    }
  }

  const nameOf = (id: string | null) => staff.find((e) => e.id === id)?.fullName ?? '—';

  return (
    <div className="space-y-3 rounded-lg border border-app p-3">
      {detail.loading && <Skeleton className="h-16" />}
      {detail.data && (
        <ol className="space-y-1 text-sm">
          {detail.data.movements.length === 0 && (
            <li className="text-muted">Belum ada pergerakan sejak aset didaftarkan.</li>
          )}
          {detail.data.movements.map((m) => (
            <li key={m.id} className="text-muted">
              <b className="text-app">{ASSET_MOVEMENT_LABEL[m.kind]}</b> · {fmtDate(m.movedAt)}
              {m.fromEmployeeId ? ` · dari ${nameOf(m.fromEmployeeId)}` : ''}
              {m.toEmployeeId ? ` · ke ${nameOf(m.toEmployeeId)}` : ''}
              {m.condition ? ` · kondisi: ${m.condition}` : ''}
            </li>
          ))}
        </ol>
      )}

      {isAdmin &&
        (moves.length === 0 ? (
          <p className="text-sm text-muted">
            Aset sudah dihapusbukukan. Jika barang ditemukan, daftarkan sebagai aset baru.
          </p>
        ) : (
          <form onSubmit={submit} className="grid gap-3 border-t border-app pt-3 sm:grid-cols-2">
            <Field label="Pergerakan">
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as AssetMovementKind)}
                className="surface-elevated w-full rounded-lg border border-app px-3.5 py-2.5 text-sm"
              >
                {moves.map((k) => (
                  <option key={k} value={k}>
                    {ASSET_MOVEMENT_LABEL[k]}
                  </option>
                ))}
              </select>
            </Field>
            {assetMoveNeedsRecipient(kind) && (
              <Field label="Karyawan penerima">
                <select
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  className="surface-elevated w-full rounded-lg border border-app px-3.5 py-2.5 text-sm"
                >
                  <option value="">Pilih karyawan</option>
                  {staff
                    .filter((s) => s.depotId === asset.depotId)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.employeeCode} · {s.fullName}
                      </option>
                    ))}
                </select>
              </Field>
            )}
            <Field label="Kondisi barang (opsional)">
              <Input
                value={condition}
                onChange={(e) => setCondition(e.target.value)}
                placeholder="lecet di spakbor"
              />
            </Field>
            <div className="col-span-full">
              <Button type="submit" loading={saving}>
                Catat Pergerakan
              </Button>
            </div>
          </form>
        ))}
    </div>
  );
}

function NewAsset({ onCreated }: { onCreated: () => void }) {
  const { depots } = useDepot();
  const { toast } = useToast();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState<AssetType>('MOTORCYCLE');
  const [depotId, setDepotId] = useState('');
  const [brand, setBrand] = useState('');
  const [serialNo, setSerialNo] = useState('');
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim() || !name.trim() || !depotId) {
      toast('Isi kode, nama, dan depot', 'error');
      return;
    }
    setSaving(true);
    try {
      await api.post(
        endpoints.hr.createAsset,
        {
          code: code.trim(),
          name: name.trim(),
          type,
          depotId,
          ...(brand.trim() ? { brand: brand.trim() } : {}),
          ...(serialNo.trim() ? { serialNo: serialNo.trim() } : {}),
          ...(Number(value) > 0 ? { value: Number(value) } : {}),
        },
        true,
      );
      toast('Aset didaftarkan');
      setCode('');
      setName('');
      setBrand('');
      setSerialNo('');
      setValue('');
      onCreated();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Gagal mendaftarkan aset', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="space-y-4 p-5">
      <h2 className="text-sm font-semibold">Daftarkan Aset</h2>
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        <Field label="Kode aset">
          <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="MTR-0001" />
        </Field>
        <Field label="Nama">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Honda Beat" />
        </Field>
        <Field label="Jenis">
          <select
            value={type}
            onChange={(e) => setType(e.target.value as AssetType)}
            className="surface-elevated w-full rounded-lg border border-app px-3.5 py-2.5 text-sm"
          >
            {ASSET_TYPES.map((t) => (
              <option key={t} value={t}>
                {ASSET_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Depot pemilik">
          <select
            value={depotId}
            onChange={(e) => setDepotId(e.target.value)}
            className="surface-elevated w-full rounded-lg border border-app px-3.5 py-2.5 text-sm"
          >
            <option value="">Pilih depot</option>
            {depots.map((d) => (
              <option key={d.id} value={d.id}>
                {d.code}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Merek (opsional)">
          <Input value={brand} onChange={(e) => setBrand(e.target.value)} />
        </Field>
        <Field label="Nomor seri (opsional)">
          <Input value={serialNo} onChange={(e) => setSerialNo(e.target.value)} />
        </Field>
        <Field label="Nilai perolehan (Rp, opsional)">
          <Input type="number" value={value} onChange={(e) => setValue(e.target.value)} />
        </Field>
        <div className="col-span-full">
          <Button type="submit" loading={saving}>
            Daftarkan
          </Button>
        </div>
      </form>
    </Card>
  );
}
