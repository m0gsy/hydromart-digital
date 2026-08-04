'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { HR_MANAGED_ROLES, type HrManagedRole } from '@hydromart/access';
import { Button, Card, Field, Input } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import {
  EMPLOYMENT_STATUS_LABEL,
  GENDER_LABEL,
  HR_ROLE_LABEL,
  PTKP_STATUS_LABEL,
  departmentsForDepot,
  type Department,
  type Employee,
  type EmployeeForm as Form,
  type EmploymentStatus,
  type Gender,
  type HrPage,
  type PtkpStatus,
  type SalaryType,
  toEmployeePayload,
} from '@/lib/hr';
import { useAsync } from '@/lib/use-async';
import type { Customer } from '@/lib/types';

interface DepotOption {
  id: string;
  name: string;
}

/** Create or edit an employee. `id` present → PATCH; absent → POST. */
export function EmployeeForm({ initial, id }: { initial: Form; id?: string }) {
  const router = useRouter();
  const { toast: notify } = useToast();
  const [form, setForm] = useState<Form>(initial);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const depots = useAsync<{ items: DepotOption[] }>(
    () => api.get<{ items: DepotOption[] }>(endpoints.depots.browse({ limit: 100 }), true),
    [],
  );


  const departments = useAsync<Department[]>(
    () => api.get<Department[]>(endpoints.hr.departments(), true),
    [],
  );
  // Only this depot's units plus the network-wide ones — the server rejects the rest anyway.
  const deptOptions = form.depotId ? departmentsForDepot(departments.data ?? [], form.depotId) : [];

  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    // A corrected number is a different person: the confirmation has to be asked again.
    if (k === 'phone') setConfirmOwner(null);
    setForm((f) => ({ ...f, [k]: v }));
  };

  /**
   * Whoever already owns the phone number being typed, when adding.
   *
   * Saving promotes that account to the chosen jabatan, so one mistyped digit turns a
   * customer into a kepala depot. The name is shown and confirmed before the write, rather
   * than discovered afterwards by the person who lost their account.
   */
  const [confirmOwner, setConfirmOwner] = useState<Customer | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const payload = toEmployeePayload(form, { creating: !id });
    if (!payload.ok) {
      setErr(payload.error);
      return;
    }
    // Ask auth-service whose number this is, once, before the first save attempt. 404 (no
    // account) and any lookup failure both fall through to the normal save: the pre-check
    // is a warning, not a gate — the server still decides.
    if (!id && !confirmOwner) {
      const owner = await api
        .get<Customer>(endpoints.auth.customerLookup(form.phone.trim()), true)
        .catch(() => null);
      if (owner) {
        setConfirmOwner(owner);
        return;
      }
    }
    setSaving(true);
    try {
      if (id) await api.patch(endpoints.hr.updateEmployee(id), payload.value, true);
      else await api.post(endpoints.hr.createEmployee, payload.value, true);
      notify(id ? 'Karyawan diperbarui' : 'Karyawan ditambahkan');
      router.push(id ? `/hr/employees/${id}` : '/hr/employees');
      router.refresh();
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : 'Gagal menyimpan.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Card className="grid gap-4 p-5 sm:grid-cols-2">
        <Field label="Nama lengkap">
          <Input value={form.fullName} onChange={(e) => set('fullName', e.target.value)} />
        </Field>
        <Field label="Posisi">
          <Input value={form.position} onChange={(e) => set('position', e.target.value)} />
        </Field>
        <Field label="No. HP">
          <Input value={form.phone} onChange={(e) => set('phone', e.target.value)} />
        </Field>
        <Field label="Email (opsional)">
          <Input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
        </Field>

        <Field label="Depot">
          <select
            value={form.depotId}
            onChange={(e) => set('depotId', e.target.value)}
            className="surface-elevated w-full rounded-lg border border-app px-3.5 py-2.5 text-sm"
          >
            <option value="">Pilih depot…</option>
            {depots.data?.items.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Tanggal masuk">
          <Input
            type="date"
            value={form.joinDate}
            onChange={(e) => set('joinDate', e.target.value)}
          />
        </Field>

        {/* Changing this re-roles the person's LOGIN, not just their file — which is the
            point: a promotion that only changed the title left the old access in place. */}
        <Field label="Jabatan (peran login)">
          <select
            value={form.role}
            onChange={(e) => set('role', e.target.value as HrManagedRole | '')}
            className="surface-elevated w-full rounded-lg border border-app px-3.5 py-2.5 text-sm"
          >
            {/* Required when adding: the login account is created with this role. */}
            <option value="">{id ? 'Tidak diubah' : 'Pilih jabatan…'}</option>
            {HR_MANAGED_ROLES.map((r) => (
              <option key={r} value={r}>
                {HR_ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Status kepegawaian">
          <select
            value={form.employmentStatus}
            onChange={(e) => set('employmentStatus', e.target.value as EmploymentStatus)}
            className="surface-elevated w-full rounded-lg border border-app px-3.5 py-2.5 text-sm"
          >
            {(Object.keys(EMPLOYMENT_STATUS_LABEL) as EmploymentStatus[]).map((s) => (
              <option key={s} value={s}>
                {EMPLOYMENT_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Tipe gaji">
          <select
            value={form.salaryType}
            onChange={(e) => set('salaryType', e.target.value as SalaryType)}
            className="surface-elevated w-full rounded-lg border border-app px-3.5 py-2.5 text-sm"
          >
            <option value="DAILY">Harian</option>
            <option value="MONTHLY">Bulanan</option>
          </select>
        </Field>

        {form.salaryType === 'DAILY' ? (
          <Field label="Gaji harian (Rp)">
            <Input
              type="number"
              value={form.dailyRate}
              onChange={(e) => set('dailyRate', e.target.value)}
            />
          </Field>
        ) : (
          <Field label="Gaji bulanan (Rp)">
            <Input
              type="number"
              value={form.monthlyRate}
              onChange={(e) => set('monthlyRate', e.target.value)}
            />
          </Field>
        )}

        <Field label="Nama bank (opsional)">
          <Input value={form.bankName} onChange={(e) => set('bankName', e.target.value)} />
        </Field>
        <Field label="No. rekening (opsional)">
          <Input value={form.bankAccount} onChange={(e) => set('bankAccount', e.target.value)} />
        </Field>
        <Field label="Kontak darurat (opsional)">
          <Input
            value={form.emergencyName}
            onChange={(e) => set('emergencyName', e.target.value)}
          />
        </Field>
        <Field label="No. kontak darurat (opsional)">
          <Input
            value={form.emergencyPhone}
            onChange={(e) => set('emergencyPhone', e.target.value)}
          />
        </Field>

        {/* "Atasan" used to live here and wrote a column nobody else read, so the same
            person could have one superior in HR and another in the hierarchy map. The
            reporting line is recorded once, at /hq/hierarchy, and shown read-only on the
            employee's detail page. */}
        <Field label="Departemen (opsional)">
          <select
            value={form.departmentId}
            onChange={(e) => set('departmentId', e.target.value)}
            disabled={!form.depotId}
            className="surface-elevated w-full rounded-lg border border-app px-3.5 py-2.5 text-sm disabled:opacity-50"
          >
            <option value="">{form.depotId ? 'Belum diatur' : 'Pilih depot dulu…'}</option>
            {deptOptions.map((d) => (
              <option key={d.id} value={d.id}>
                {d.code} — {d.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="NPWP (opsional)">
          <Input value={form.npwp} onChange={(e) => set('npwp', e.target.value)} />
        </Field>
        <Field label="BPJS Kesehatan (opsional)">
          <Input value={form.bpjsKes} onChange={(e) => set('bpjsKes', e.target.value)} />
        </Field>
        <Field label="BPJS Ketenagakerjaan (opsional)">
          <Input value={form.bpjsTk} onChange={(e) => set('bpjsTk', e.target.value)} />
        </Field>

        <Field label="NIK KTP (opsional)">
          <Input
            value={form.nik}
            inputMode="numeric"
            maxLength={16}
            onChange={(e) => set('nik', e.target.value)}
          />
        </Field>
        <Field label="Tanggal lahir (opsional)">
          <Input
            type="date"
            value={form.birthDate}
            onChange={(e) => set('birthDate', e.target.value)}
          />
        </Field>
        <Field label="Jenis kelamin (opsional)">
          <select
            value={form.gender}
            onChange={(e) => set('gender', e.target.value as Gender | '')}
            className="surface-elevated w-full rounded-lg border border-app px-3.5 py-2.5 text-sm"
          >
            <option value="">Tidak diisi</option>
            {(Object.keys(GENDER_LABEL) as Gender[]).map((g) => (
              <option key={g} value={g}>
                {GENDER_LABEL[g]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Status PTKP (opsional)">
          <select
            value={form.ptkpStatus}
            onChange={(e) => set('ptkpStatus', e.target.value as PtkpStatus | '')}
            className="surface-elevated w-full rounded-lg border border-app px-3.5 py-2.5 text-sm"
          >
            <option value="">Tidak diisi</option>
            {(Object.keys(PTKP_STATUS_LABEL) as PtkpStatus[]).map((p) => (
              <option key={p} value={p}>
                {PTKP_STATUS_LABEL[p]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Akhir kontrak (opsional)">
          <Input
            type="date"
            value={form.contractEndDate}
            onChange={(e) => set('contractEndDate', e.target.value)}
          />
        </Field>
        <Field label="Alamat (opsional)">
          <Input value={form.address} onChange={(e) => set('address', e.target.value)} />
        </Field>
      </Card>

      {err && (
        <p className="text-sm font-medium text-red-600" role="alert">
          {err}
        </p>
      )}

      {/* Saving does not create a second account for a number that already has one — it
          promotes the one that is there. Whose it is has to be read before that happens. */}
      {confirmOwner && (
        <Card className="border-amber-300 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-900" role="alert">
            Nomor {form.phone} sudah dipakai akun atas nama{' '}
            {confirmOwner.fullName || '(tanpa nama)'} ({HR_ROLE_LABEL[confirmOwner.role as HrManagedRole] ?? confirmOwner.role}).
          </p>
          <p className="mt-1 text-sm text-amber-900">
            Menyimpan akan mengubah akun itu menjadi{' '}
            {form.role ? HR_ROLE_LABEL[form.role] : 'jabatan yang dipilih'} — bukan membuat akun
            baru. Kalau nomornya salah ketik, betulkan dulu.
          </p>
        </Card>
      )}

      <div className="flex gap-3">
        <Button type="submit" loading={saving}>
          {confirmOwner
            ? 'Ya, gunakan akun itu'
            : id
              ? 'Simpan Perubahan'
              : 'Tambah Karyawan'}
        </Button>
        <Button type="button" variant="secondary" onClick={() => router.back()}>
          Batal
        </Button>
      </div>
    </form>
  );
}
