'use client';

import { useState } from 'react';

import { Button, Card, Field, Input } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';

// Staff roles assignable from HQ (CUSTOMER is never assignable here). Same set as the
// ops staff console — this just restyles role selection as buttons (design 4b) and
// reuses the identical inviteStaff call.
const STAFF_ROLES = [
  'DEPOT_MANAGER',
  'DEPOT_OPERATOR',
  'DRIVER',
  'MARKETING',
  'FINANCE',
  'FRANCHISE_OWNER',
  'HEAD_OFFICE',
  'SUPER_ADMIN',
] as const;

export function StaffInvite({ onSaved }: { onSaved: () => void }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<string>('DEPOT_OPERATOR');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (phone.trim() === '') {
      setError(t('hq.staff.form.phoneRequired'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post(
        endpoints.auth.inviteStaff,
        { phone: phone.trim(), role, fullName: fullName || undefined },
        true,
      );
      setPhone('');
      setFullName('');
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
            placeholder="mis. Budi"
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
                'rounded-full px-3 py-1.5 text-xs font-bold transition-colors ' +
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
