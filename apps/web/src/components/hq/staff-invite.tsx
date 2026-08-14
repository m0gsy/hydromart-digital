'use client';

import { useState } from 'react';

import { Button, Card, Field, Input, LoadError } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAsync } from '@/lib/use-async';
import { useT } from '@/lib/locale-context';
import type { DepotAdmin, Page } from '@/lib/types';

// Staff roles assignable from HQ (CUSTOMER is never assignable here). Same set as the
// ops staff console — this just restyles role selection as buttons (design 4b) and
// reuses the identical inviteStaff call.
const STAFF_ROLES = [
  'STAFF_DEPOT',
  'KEPALA_DEPOT',
  'ASSISTANT_SUPERVISOR',
  'SUPERVISOR',
  'MANAGER',
  'DIREKTUR',
  'MARKETING',
  'FINANCE',
  'HR',
  'FRANCHISE_OWNER',
  'HEAD_OFFICE',
  'SUPER_ADMIN',
] as const;

const EMPLOYMENT_STATUSES = ['TRAINING', 'PROBATION', 'PERMANENT'] as const;

/** Today, as the `yyyy-mm-dd` a date input wants. Local, because a join date is a calendar day. */
function today(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

export function StaffInvite({ onSaved }: { onSaved: () => void }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<string>('KEPALA_DEPOT');
  const [depotId, setDepotId] = useState('');
  // Inviting somebody now opens their employee record too, so the console has to ask for
  // what HR needs to pay and roster them. A franchise owner is skipped server-side.
  const [position, setPosition] = useState('');
  const [joinDate, setJoinDate] = useState(today());
  const [employmentStatus, setEmploymentStatus] = useState<string>('PROBATION');
  const [salaryType, setSalaryType] = useState<'DAILY' | 'MONTHLY'>('MONTHLY');
  const [rate, setRate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const depots = useAsync<Page<DepotAdmin>>(() => api.getCached(endpoints.depots.manage({ limit: 100 }), true));

  const isOwner = role === 'FRANCHISE_OWNER';

  async function submit() {
    if (phone.trim() === '') {
      setError(t('hq.staff.form.phoneRequired'));
      return;
    }
    // D-11: `Number('') <= 0` is false for NaN, so a rate that will not parse got through
    // the guard and serialised to null. Near-unreachable behind `<Input type="number">`, but
    // the guard should mean what it says.
    if (!isOwner && (position.trim() === '' || !(Number(rate) > 0))) {
      setError(t('hq.staff.form.employmentRequired'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post(
        endpoints.auth.inviteStaff,
        {
          phone: phone.trim(),
          role,
          fullName: fullName || undefined,
          depotId: depotId || undefined,
          // A franchise owner gets no employee record, but the API still validates the
          // shape — send something honest rather than blank.
          position: isOwner ? 'Pemilik waralaba' : position.trim(),
          joinDate,
          employmentStatus: isOwner ? 'PERMANENT' : employmentStatus,
          salaryType: isOwner ? 'MONTHLY' : salaryType,
          ...(isOwner
            ? { monthlyRate: 0 }
            : salaryType === 'DAILY'
              ? { dailyRate: Number(rate) }
              : { monthlyRate: Number(rate) }),
        },
        true,
      );
      setPhone('');
      setFullName('');
      setDepotId('');
      setPosition('');
      setRate('');
      setOpen(false);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('hq.staff.form.error'));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return <Button onClick={() => setOpen(true)}>＋ {t('hq.staff.invite')}</Button>;
  }

  return (
    <Card className="flex w-full flex-col gap-3 p-4">
      <p className="font-semibold">{t('hq.staff.form.title')}</p>
      <p className="text-xs text-muted">{t('hq.staff.form.hint')}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('hq.staff.form.phone')} htmlFor="hq-st-phone">
          <Input
            id="hq-st-phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+62812…"
            autoFocus
          />
        </Field>
        <Field label={t('hq.staff.form.name')} htmlFor="hq-st-name">
          <Input
            id="hq-st-name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder={t('hrFix.staffInvite.nameHint')}
          />
        </Field>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">{t('hq.staff.form.role')}</span>
        <div className="flex flex-wrap gap-2">
          {STAFF_ROLES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRole(r)}
              aria-pressed={role === r}
              className={
                'min-h-11 rounded-full px-3 py-1.5 text-xs font-bold transition-colors ' +
                (role === r
                  ? 'bg-brand-600 text-on-brand'
                  : 'border border-app text-muted hover:bg-brand-50')
              }
            >
              {t(`hq.roles.${r}`)}
            </button>
          ))}
        </div>
      </div>
      <Field label={t('hq.staff.form.depot')} htmlFor="hq-st-depot">
        <select
          id="hq-st-depot"
          value={depotId}
          onChange={(e) => setDepotId(e.target.value)}
          className="surface-elevated w-full rounded-lg border border-app px-3.5 py-2.5 text-sm focus:outline focus:outline-2 focus:outline-brand-600"
        >
          <option value="">{t('hq.staff.form.depotNone')}</option>
          {(depots.data?.items ?? []).map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        {/* Unread depots leave only "no depot", and the invited staff member lands
            unscoped — which is a permissions answer, not a blank field. */}
        {depots.error && <LoadError onRetry={depots.reload} />}
      </Field>
      {/* Hidden for a franchise owner: they are a business counterpart, not headcount. */}
      {!isOwner && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('hq.staff.form.position')} htmlFor="hq-st-position">
            <Input
              id="hq-st-position"
              value={position}
              onChange={(e) => setPosition(e.target.value)}
              placeholder={t('hrFix.staffInvite.positionHint')}
            />
          </Field>
          <Field label={t('hq.staff.form.joinDate')} htmlFor="hq-st-join">
            <Input
              id="hq-st-join"
              type="date"
              value={joinDate}
              onChange={(e) => setJoinDate(e.target.value)}
            />
          </Field>
          <Field label={t('hq.staff.form.employmentStatus')} htmlFor="hq-st-emp">
            <select
              id="hq-st-emp"
              value={employmentStatus}
              onChange={(e) => setEmploymentStatus(e.target.value)}
              className="surface-elevated w-full rounded-lg border border-app px-3.5 py-2.5 text-sm"
            >
              {EMPLOYMENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`hq.staff.form.employment.${s}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('hq.staff.form.salary')} htmlFor="hq-st-rate">
            <div className="flex gap-2">
              <select
                value={salaryType}
                onChange={(e) => setSalaryType(e.target.value as 'DAILY' | 'MONTHLY')}
                className="surface-elevated rounded-lg border border-app px-2 py-2.5 text-sm"
              >
                <option value="MONTHLY">{t('hq.staff.form.salaryMonthly')}</option>
                <option value="DAILY">{t('hq.staff.form.salaryDaily')}</option>
              </select>
              <Input
                id="hq-st-rate"
                type="number"
                min={0}
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                placeholder="0"
              />
            </div>
          </Field>
        </div>
      )}

      {error && (
        <p className="text-sm font-medium text-red-600" role="alert">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
          {t('hq.staff.form.cancel')}
        </Button>
        <Button onClick={submit} loading={busy}>
          {t('hq.staff.form.submit')}
        </Button>
      </div>
    </Card>
  );
}
