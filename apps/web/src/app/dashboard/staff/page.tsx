'use client';

import { useState } from 'react';
import { Lock, UserGear, UserPlus } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Badge, Button, Card, CenterState, ErrorState, Field, Input, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import { CAPABILITIES, canManageStaff, type Capability } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import type { Customer, Page } from '@/lib/types';

// Staff roles selectable in the invite form (CUSTOMER is not assignable here).
const STAFF_ROLES = [
  'DRIVER',
  'DEPOT_OPERATOR',
  'DEPOT_MANAGER',
  'FRANCHISE_OWNER',
  'HEAD_OFFICE',
  'FINANCE',
  'MARKETING',
  'SUPER_ADMIN',
] as const;

const ROLE_LABELS: Record<string, string> = {
  DRIVER: 'Driver',
  DEPOT_OPERATOR: 'Operator depot',
  DEPOT_MANAGER: 'Manajer depot',
  FRANCHISE_OWNER: 'Pemilik waralaba',
  HEAD_OFFICE: 'Head office',
  FINANCE: 'Finance',
  MARKETING: 'Marketing',
  SUPER_ADMIN: 'Super admin',
};

function selectClass() {
  return 'w-full rounded-xl border border-app bg-transparent px-3 py-2.5 text-sm font-medium';
}

function InviteForm({ onSaved }: { onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<string>('DEPOT_OPERATOR');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (phone.trim() === '') {
      setError('Masukkan nomor telepon.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post(endpoints.auth.inviteStaff, { phone: phone.trim(), role, fullName: fullName || undefined }, true);
      setPhone('');
      setFullName('');
      setOpen(false);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal mengundang staf.');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)}>
        <UserPlus size={16} weight="bold" className="mr-1.5" />
        Undang staf
      </Button>
    );
  }

  return (
    <Card className="flex flex-col gap-3 p-4">
      <p className="font-semibold">Undang / tetapkan peran staf</p>
      <p className="text-xs text-muted">
        Nomor yang sudah terdaftar akan dipromosikan; nomor baru dibuatkan akun staf aktif (login via OTP).
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nomor telepon" htmlFor="st-phone">
          <Input id="st-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+62812…" autoFocus />
        </Field>
        <Field label="Nama (untuk akun baru)" htmlFor="st-name">
          <Input id="st-name" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="mis. Budi" />
        </Field>
      </div>
      <Field label="Peran" htmlFor="st-role">
        <select id="st-role" value={role} onChange={(e) => setRole(e.target.value)} className={selectClass()}>
          {STAFF_ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
      </Field>
      {error && (
        <p className="text-sm font-medium text-red-600" role="alert">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
          Batal
        </Button>
        <Button onClick={submit} loading={busy}>
          Simpan
        </Button>
      </div>
    </Card>
  );
}

// Reference matrix "Peran & hak akses" (7b). Rows are just (label -> capability):
// the actual role lists are read from CAPABILITIES in lib/roles.ts — the SAME map
// that gates every route — so this can never drift from what the app enforces.
// Display-only; the server stays authority.
const ACCESS_MATRIX: { area: string; cap: Capability }[] = [
  { area: 'Antrean pesanan', cap: 'orderQueue' },
  { area: 'Inventory (ubah)', cap: 'inventoryWrite' },
  { area: 'Retur galon (catat)', cap: 'returnsWrite' },
  { area: 'Harga dinamis', cap: 'depotAdmin' },
  { area: 'Kelola depot', cap: 'depotAdmin' },
  { area: 'Tugaskan kurir / tracking', cap: 'tracking' },
  { area: 'Kampanye (kirim)', cap: 'campaignWrite' },
  { area: 'Voucher (kelola)', cap: 'voucherWrite' },
  { area: 'Notifikasi ops', cap: 'opsNotif' },
  { area: 'Verifikasi setoran kurir', cap: 'courierSettle' },
  { area: 'Klaim pengeluaran (putuskan)', cap: 'expenseApprove' },
  { area: 'Broadcast ke kurir', cap: 'depotBroadcast' },
  { area: 'Staf & peran', cap: 'staffAdmin' },
  { area: 'Payout / komisi', cap: 'payout' },
  { area: 'Dashboard eksekutif', cap: 'dashboard' },
];

function AccessMatrix() {
  const [open, setOpen] = useState(false);
  return (
    <Card className="flex flex-col gap-3 p-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-between text-left"
        aria-expanded={open}
      >
        <span className="font-semibold">Peran &amp; hak akses</span>
        <span className="text-sm font-medium text-brand-600">{open ? 'Tutup' : 'Lihat matriks'}</span>
      </button>
      {open && (
        <ul className="flex flex-col divide-y divide-[color:var(--border)]">
          {ACCESS_MATRIX.map((row) => (
            <li key={row.area} className="flex flex-wrap items-center gap-2 py-2">
              <span className="min-w-44 text-sm font-medium">{row.area}</span>
              <span className="flex flex-wrap gap-1.5">
                {CAPABILITIES[row.cap].map((r) => (
                  <Badge key={r} tone="neutral">
                    {ROLE_LABELS[r] ?? r}
                  </Badge>
                ))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function StaffRow({ s }: { s: Customer }) {
  return (
    <Card className="flex items-center justify-between gap-3 p-3.5">
      <div className="min-w-0">
        <p className="truncate font-semibold">{s.fullName || s.phone}</p>
        <p className="truncate text-xs text-muted">
          {s.phone}
          {s.status !== 'ACTIVE' ? ` · ${s.status}` : ''}
        </p>
      </div>
      <Badge tone="brand">{ROLE_LABELS[s.role] ?? s.role}</Badge>
    </Card>
  );
}

function StaffBody() {
  const [roleFilter, setRoleFilter] = useState('');
  const list = useAsync<Page<Customer>>(
    () => api.get(endpoints.auth.staff({ limit: 100, role: roleFilter || undefined }), true),
    [roleFilter],
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <UserGear size={24} weight="fill" className="text-brand-500" />
          <h1 className="text-2xl font-bold">Staf & peran</h1>
        </div>
        <InviteForm onSaved={list.reload} />
      </div>

      <AccessMatrix />

      <div className="flex items-center gap-2">
        <label htmlFor="st-filter" className="text-sm font-medium text-muted">
          Peran
        </label>
        <select
          id="st-filter"
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className="rounded-xl border border-app bg-transparent px-3 py-2 text-sm font-medium"
        >
          <option value="">Semua</option>
          {STAFF_ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
      </div>

      {list.loading ? (
        <Skeleton className="h-64 w-full" />
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : !list.data || list.data.items.length === 0 ? (
        <CenterState title="Belum ada staf" icon={<UserGear size={40} weight="fill" />}>
          Undang staf pertama dengan nomor telepon mereka.
        </CenterState>
      ) : (
        <div className="flex flex-col gap-2.5">
          {list.data.items.map((s) => (
            <StaffRow key={s.id} s={s} />
          ))}
        </div>
      )}
    </div>
  );
}

function Gate() {
  const { customer } = useAuth();
  if (!canManageStaff(customer?.role)) {
    return (
      <CenterState title="Khusus admin" icon={<Lock size={40} weight="fill" />}>
        Manajemen staf & peran tersedia untuk head office dan super admin.
      </CenterState>
    );
  }
  return <StaffBody />;
}

export default function StaffPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
