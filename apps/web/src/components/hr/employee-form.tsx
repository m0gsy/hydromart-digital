'use client';

import { useRouter } from 'next/navigation';
import { useT } from '@/lib/locale-context';
import { useState } from 'react';

import { HR_MANAGED_ROLES, type HrManagedRole } from '@hydromart/access';
import { Button, Card, Field, Input, LoadError } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import {
  EMPLOYEE_STATUS_LABEL,
  EMPLOYMENT_STATUS_LABEL,
  GENDER_LABEL,
  HR_ROLE_LABEL,
  PTKP_STATUS_LABEL,
  departmentsForDepot,
  type Department,
  type EmployeeForm as Form,
  type EmployeeStatus,
  type EmploymentStatus,
  type Gender,
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
  const { t } = useT();
  const router = useRouter();
  const { toast: notify } = useToast();
  const [form, setForm] = useState<Form>(initial);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // K-9: reference data, so getCached — main converted every one of these reads (F-2/F-13)
  // and the contract is that a depot list and a department list are not re-fetched per form.
  const depots = useAsync<{ items: DepotOption[] }>(
    () => api.getCached<{ items: DepotOption[] }>(endpoints.depots.browse({ limit: 100 }), true),
    [],
  );

  const departments = useAsync<Department[]>(
    () => api.getCached<Department[]>(endpoints.hr.departments(), true),
    [],
  );
  // Only this depot's units plus the network-wide ones — the server rejects the rest anyway.
  const deptOptions = form.depotId ? departmentsForDepot(departments.data ?? [], form.depotId) : [];

  // D-12: `t(HR_ROLE_LABEL[role as HrManagedRole]) ?? role` asserted a type the value usually
  // is not — this account is nearly always a CUSTOMER. Runtime-safe via the `??`, but the
  // cast defeated the `Record`'s exhaustiveness, which is the only thing making that lookup
  // trustworthy. A plain lookup with a fallback says the same thing and stays honest.
  const roleLabel = (role: string): string =>
    (HR_ROLE_LABEL as Record<string, string | undefined>)[role] ?? role;

  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    // A corrected number is a different person: the confirmation has to be asked again.
    //
    // D-13: so is a different jabatan. The dialog names the role the account is about to
    // become, so confirming "Kurir" and then switching to "Kepala Depot" promoted somebody
    // to a role nobody agreed to — the confirmation was for a different sentence.
    if (k === 'phone' || k === 'role') setConfirmOwner(null);
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
    const payload = toEmployeePayload(form, { creating: !id, t });
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
      notify(id ? t('hrFix.employeeForm.updated') : t('hrFix.employeeForm.added'));
      router.push(id ? `/hr/employees/detail?id=${id}` : '/hr/employees');
      router.refresh();
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : t('hrFix.employeeForm.saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Card className="grid gap-4 p-5 sm:grid-cols-2">
        <Field label={t('hrFix.employeeForm.fullName')}>
          <Input value={form.fullName} onChange={(e) => set('fullName', e.target.value)} />
        </Field>
        <Field label={t('hrFix.employeeForm.position')}>
          <Input value={form.position} onChange={(e) => set('position', e.target.value)} />
        </Field>
        <Field label={t('hrFix.employeeForm.phone')}>
          <Input value={form.phone} onChange={(e) => set('phone', e.target.value)} />
        </Field>
        <Field label={t('hrFix.employeeForm.emailOpt')}>
          <Input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
        </Field>

        <Field label={t('hrFix.employeeForm.depot')}>
          <select
            value={form.depotId}
            onChange={(e) => set('depotId', e.target.value)}
            className="surface-elevated w-full rounded-lg border border-app px-3.5 py-2.5 text-sm"
          >
            <option value="">{t('hrFix.employeeForm.pickDepot')}</option>
            {depots.data?.items.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          {/* Depot is what scopes this person's whole record. An unread list is an empty
              dropdown, and the employee gets filed against no depot at all. */}
          {depots.error && <LoadError onRetry={depots.reload} />}
        </Field>
        <Field label={t('hrFix.employeeForm.joinDate')}>
          <Input
            type="date"
            value={form.joinDate}
            onChange={(e) => set('joinDate', e.target.value)}
          />
        </Field>

        {/* Changing this re-roles the person's LOGIN, not just their file — which is the
            point: a promotion that only changed the title left the old access in place. */}
        <Field label={t('hrFix.employeeForm.role')}>
          <select
            value={form.role}
            onChange={(e) => set('role', e.target.value as HrManagedRole | '')}
            className="surface-elevated w-full rounded-lg border border-app px-3.5 py-2.5 text-sm"
          >
            {/* Required when adding: the login account is created with this role. */}
            <option value="">{id ? t('hrFix.employeeForm.unchanged') : t('hrFix.employeeForm.pickRole')}</option>
            {HR_MANAGED_ROLES.map((r) => (
              <option key={r} value={r}>
                {t(HR_ROLE_LABEL[r])}
              </option>
            ))}
          </select>
        </Field>

        <Field label={t('hrFix.employeeForm.employmentStatus')}>
          <select
            value={form.employmentStatus}
            onChange={(e) => set('employmentStatus', e.target.value as EmploymentStatus)}
            className="surface-elevated w-full rounded-lg border border-app px-3.5 py-2.5 text-sm"
          >
            {(Object.keys(EMPLOYMENT_STATUS_LABEL) as EmploymentStatus[]).map((s) => (
              <option key={s} value={s}>
                {t(EMPLOYMENT_STATUS_LABEL[s])}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('hrFix.employeeForm.salaryType')}>
          <select
            value={form.salaryType}
            onChange={(e) => set('salaryType', e.target.value as SalaryType)}
            className="surface-elevated w-full rounded-lg border border-app px-3.5 py-2.5 text-sm"
          >
            <option value="DAILY">{t('hrFix.employeeForm.daily')}</option>
            <option value="MONTHLY">{t('hrFix.employeeForm.monthly')}</option>
          </select>
        </Field>

        {form.salaryType === 'DAILY' ? (
          <Field label={t('hrFix.employeeForm.dailyRate')}>
            <Input
              type="number"
              value={form.dailyRate}
              onChange={(e) => set('dailyRate', e.target.value)}
            />
          </Field>
        ) : (
          <Field label={t('hrFix.employeeForm.monthlyRate')}>
            <Input
              type="number"
              value={form.monthlyRate}
              onChange={(e) => set('monthlyRate', e.target.value)}
            />
          </Field>
        )}

        <Field label={t('hrFix.employeeForm.bankNameOpt')}>
          <Input value={form.bankName} onChange={(e) => set('bankName', e.target.value)} />
        </Field>
        <Field label={t('hrFix.employeeForm.bankAccountOpt')}>
          <Input value={form.bankAccount} onChange={(e) => set('bankAccount', e.target.value)} />
        </Field>
        <Field label={t('hrFix.employeeForm.emergencyNameOpt')}>
          <Input
            value={form.emergencyName}
            onChange={(e) => set('emergencyName', e.target.value)}
          />
        </Field>
        <Field label={t('hrFix.employeeForm.emergencyPhoneOpt')}>
          <Input
            value={form.emergencyPhone}
            onChange={(e) => set('emergencyPhone', e.target.value)}
          />
        </Field>

        {/* "Atasan" used to live here and wrote a column nobody else read, so the same
            person could have one superior in HR and another in the hierarchy map. The
            reporting line is recorded once, at /hq/hierarchy, and shown read-only on the
            employee's detail page. */}
        <Field label={t('hrFix.employeeForm.departmentOpt')}>
          <select
            value={form.departmentId}
            onChange={(e) => set('departmentId', e.target.value)}
            disabled={!form.depotId}
            className="surface-elevated w-full rounded-lg border border-app px-3.5 py-2.5 text-sm disabled:opacity-50"
          >
            <option value="">{form.depotId ? t('hrFix.employeeForm.notSet') : t('hrFix.employeeForm.pickDepotFirst')}</option>
            {deptOptions.map((d) => (
              <option key={d.id} value={d.id}>
                {d.code} — {d.name}
              </option>
            ))}
          </select>
          {departments.error && <LoadError onRetry={departments.reload} />}
        </Field>
        <Field label={t('hrFix.employeeForm.npwpOpt')}>
          <Input value={form.npwp} onChange={(e) => set('npwp', e.target.value)} />
        </Field>
        <Field label={t('hrFix.employeeForm.bpjsKesOpt')}>
          <Input value={form.bpjsKes} onChange={(e) => set('bpjsKes', e.target.value)} />
        </Field>
        <Field label={t('hrFix.employeeForm.bpjsTkOpt')}>
          <Input value={form.bpjsTk} onChange={(e) => set('bpjsTk', e.target.value)} />
        </Field>

        <Field label={t('hrFix.employeeForm.nikOpt')}>
          <Input
            value={form.nik}
            inputMode="numeric"
            maxLength={16}
            onChange={(e) => set('nik', e.target.value)}
          />
        </Field>
        <Field label={t('hrFix.employeeForm.birthDateOpt')}>
          <Input
            type="date"
            value={form.birthDate}
            onChange={(e) => set('birthDate', e.target.value)}
          />
        </Field>
        <Field label={t('hrFix.employeeForm.genderOpt')}>
          <select
            value={form.gender}
            onChange={(e) => set('gender', e.target.value as Gender | '')}
            className="surface-elevated w-full rounded-lg border border-app px-3.5 py-2.5 text-sm"
          >
            <option value="">{t('hrFix.employeeForm.notFilled')}</option>
            {(Object.keys(GENDER_LABEL) as Gender[]).map((g) => (
              <option key={g} value={g}>
                {t(GENDER_LABEL[g])}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('hrFix.employeeForm.ptkpOpt')}>
          <select
            value={form.ptkpStatus}
            onChange={(e) => set('ptkpStatus', e.target.value as PtkpStatus | '')}
            className="surface-elevated w-full rounded-lg border border-app px-3.5 py-2.5 text-sm"
          >
            <option value="">{t('hrFix.employeeForm.notFilled')}</option>
            {(Object.keys(PTKP_STATUS_LABEL) as PtkpStatus[]).map((p) => (
              <option key={p} value={p}>
                {t(PTKP_STATUS_LABEL[p])}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('hrFix.employeeForm.contractEndOpt')}>
          <Input
            type="date"
            value={form.contractEndDate}
            onChange={(e) => set('contractEndDate', e.target.value)}
          />
        </Field>
        {/* Edit only, and deliberately next to the contract end date: this is the field
            payroll clamps the paid period to. Until now nothing in the console wrote it, so
            somebody who left on the 10th kept earning a full month, every month. Setting
            the status to RESIGNED does NOT stop the wage on its own. */}
        {id && (
          <>
            <Field label={t('hrFix.employeeForm.exitDate')}>
              <Input
                type="date"
                value={form.exitDate}
                onChange={(e) => set('exitDate', e.target.value)}
              />
            </Field>
            <Field label={t('hrFix.employeeForm.status')}>
              <select
                className="surface-elevated w-full rounded-lg border border-app px-3.5 py-2.5 text-sm"
                value={form.status}
                onChange={(e) => set('status', e.target.value as EmployeeStatus)}
              >
                {(['ACTIVE', 'INACTIVE', 'RESIGNED'] as const).map((s) => (
                  <option key={s} value={s}>
                    {t(EMPLOYEE_STATUS_LABEL[s])}
                  </option>
                ))}
              </select>
            </Field>
            {form.status === 'RESIGNED' && !form.exitDate.trim() && (
              <p className="text-xs text-amber-700">
                Status RESIGNED tidak menghentikan gaji — isi tanggal keluar, itu yang dibaca
                payroll.
              </p>
            )}
          </>
        )}
        <Field label={t('hrFix.employeeForm.addressOpt')}>
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
            {confirmOwner.fullName || t('hrFix.employeeForm.noName')} ({roleLabel(confirmOwner.role)}).
          </p>
          <p className="mt-1 text-sm text-amber-900">
            Menyimpan akan mengubah akun itu menjadi{' '}
            {form.role ? t(HR_ROLE_LABEL[form.role]) : t('hrFix.employeeForm.chosenRole')} — bukan membuat akun
            baru. Kalau nomornya salah ketik, betulkan dulu.
          </p>
        </Card>
      )}

      <div className="flex gap-3">
        <Button type="submit" loading={saving}>
          {confirmOwner
            ? t('hrFix.employeeForm.useThatAccount')
            : id
              ? t('hrFix.employeeForm.saveChanges')
              : t('hrFix.employeeForm.addEmployee')}
        </Button>
        <Button type="button" variant="secondary" onClick={() => router.back()}>
          {t('hrFix.employeeForm.cancel2')}
        </Button>
      </div>
    </form>
  );
}
