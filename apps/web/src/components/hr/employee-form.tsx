'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button, Card, Field, Input } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import {
  EMPLOYMENT_STATUS_LABEL,
  type EmployeeForm as Form,
  type EmploymentStatus,
  type SalaryType,
  toEmployeePayload,
} from '@/lib/hr';
import { useAsync } from '@/lib/use-async';

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

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const payload = toEmployeePayload(form);
    if (!payload.ok) {
      setErr(payload.error);
      return;
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
        <Field label="Nama lengkap"><Input value={form.fullName} onChange={(e) => set('fullName', e.target.value)} /></Field>
        <Field label="Posisi"><Input value={form.position} onChange={(e) => set('position', e.target.value)} /></Field>
        <Field label="No. HP"><Input value={form.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
        <Field label="Email (opsional)"><Input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} /></Field>

        <Field label="Depot">
          <select value={form.depotId} onChange={(e) => set('depotId', e.target.value)} className="surface-elevated w-full rounded-lg border border-app px-3.5 py-2.5 text-sm">
            <option value="">Pilih depot…</option>
            {depots.data?.items.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Field>
        <Field label="Tanggal masuk"><Input type="date" value={form.joinDate} onChange={(e) => set('joinDate', e.target.value)} /></Field>

        <Field label="Status kepegawaian">
          <select value={form.employmentStatus} onChange={(e) => set('employmentStatus', e.target.value as EmploymentStatus)} className="surface-elevated w-full rounded-lg border border-app px-3.5 py-2.5 text-sm">
            {(Object.keys(EMPLOYMENT_STATUS_LABEL) as EmploymentStatus[]).map((s) => <option key={s} value={s}>{EMPLOYMENT_STATUS_LABEL[s]}</option>)}
          </select>
        </Field>
        <Field label="Tipe gaji">
          <select value={form.salaryType} onChange={(e) => set('salaryType', e.target.value as SalaryType)} className="surface-elevated w-full rounded-lg border border-app px-3.5 py-2.5 text-sm">
            <option value="DAILY">Harian</option>
            <option value="MONTHLY">Bulanan</option>
          </select>
        </Field>

        {form.salaryType === 'DAILY' ? (
          <Field label="Gaji harian (Rp)"><Input type="number" value={form.dailyRate} onChange={(e) => set('dailyRate', e.target.value)} /></Field>
        ) : (
          <Field label="Gaji bulanan (Rp)"><Input type="number" value={form.monthlyRate} onChange={(e) => set('monthlyRate', e.target.value)} /></Field>
        )}

        <Field label="Nama bank (opsional)"><Input value={form.bankName} onChange={(e) => set('bankName', e.target.value)} /></Field>
        <Field label="No. rekening (opsional)"><Input value={form.bankAccount} onChange={(e) => set('bankAccount', e.target.value)} /></Field>
        <Field label="Kontak darurat (opsional)"><Input value={form.emergencyName} onChange={(e) => set('emergencyName', e.target.value)} /></Field>
        <Field label="No. kontak darurat (opsional)"><Input value={form.emergencyPhone} onChange={(e) => set('emergencyPhone', e.target.value)} /></Field>
      </Card>

      {err && <p className="text-sm font-medium text-red-600" role="alert">{err}</p>}
      <div className="flex gap-3">
        <Button type="submit" loading={saving}>{id ? 'Simpan Perubahan' : 'Tambah Karyawan'}</Button>
        <Button type="button" variant="secondary" onClick={() => router.back()}>Batal</Button>
      </div>
    </form>
  );
}
