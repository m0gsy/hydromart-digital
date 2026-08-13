'use client';

import { useState } from 'react';

import { useToast } from '@/components/toast';
import { useT } from '@/lib/locale-context';
import { Button, Card, ErrorState, Input, SectionHeader, Skeleton } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { fmtDate, type Holiday, type Shift } from '@/lib/hr';
import { canManageHr } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';

export default function CalendarPage() {
  const { customer } = useAuth();
  const { toast } = useToast();
  const { t } = useT();
  const isAdmin = canManageHr(customer?.role);

  const holidays = useAsync<Holiday[]>(() => api.get<Holiday[]>(endpoints.hr.holidays(), true), []);
  const shifts = useAsync<Shift[]>(() => api.get<Shift[]>(endpoints.hr.shifts(), true), []);

  const [hDate, setHDate] = useState('');
  const [hName, setHName] = useState('');
  const [sName, setSName] = useState('');
  const [sStart, setSStart] = useState('08:00');
  const [sEnd, setSEnd] = useState('17:00');

  async function addHoliday() {
    if (!hDate || !hName) { toast(t('hrFix.calendar.fillDateName'), 'error'); return; }
    try {
      await api.post(endpoints.hr.createHoliday, { date: new Date(hDate).toISOString(), name: hName }, true);
      toast(t('hrFix.calendar.holidayAdded')); setHDate(''); setHName(''); holidays.reload();
    } catch (e) { toast(e instanceof ApiError ? e.message : t('hrFix.calendar.failed'), 'error'); }
  }
  async function delHoliday(id: string) {
    try { await api.del(endpoints.hr.deleteHoliday(id), true); toast(t('hrFix.calendar.deleted')); holidays.reload(); }
    catch (e) { toast(e instanceof ApiError ? e.message : t('hrFix.calendar.failed'), 'error'); }
  }
  async function addShift() {
    if (!sName) { toast(t('hrFix.calendar.fillShiftName'), 'error'); return; }
    try {
      await api.post(endpoints.hr.createShift, { name: sName, startTime: sStart, endTime: sEnd }, true);
      toast(t('hrFix.calendar.shiftAdded')); setSName(''); shifts.reload();
    } catch (e) { toast(e instanceof ApiError ? e.message : t('hrFix.calendar.failed'), 'error'); }
  }
  /**
   * Deactivate rather than delete, when the shift has been used.
   *
   * `PATCH /hr-shifts/:id` has always existed and nothing called it, so the only way to
   * retire a shift was to delete it — and shift times feed late-arrival and absence
   * deductions, so removing one rewrites how past days are read. Toggling `active` keeps
   * the row for that history while taking it out of every future rota.
   */
  async function toggleShift(id: string, active: boolean) {
    try {
      await api.patch(endpoints.hr.updateShift(id), { active: !active }, true);
      toast(active ? t('hrFix.calendar.shiftOff') : t('hrFix.calendar.shiftOn'));
      shifts.reload();
    } catch (e) { toast(e instanceof ApiError ? e.message : t('hrFix.calendar.failed'), 'error'); }
  }
  async function delShift(id: string) {
    try { await api.del(endpoints.hr.deleteShift(id), true); toast(t('hrFix.calendar.deleted')); shifts.reload(); }
    catch (e) { toast(e instanceof ApiError ? e.message : t('hrFix.calendar.failed'), 'error'); }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <SectionHeader title={t('hrFix.calendar.title')} subtitle={t('hrFix.calendar.subtitle')} />

      <Card className="space-y-3 p-5">
        <h3 className="font-bold">{t('hrFix.calendar.holidays')}</h3>
        {holidays.loading && <Skeleton className="h-20" />}
        {holidays.error && <ErrorState message={holidays.error} onRetry={holidays.reload} />}
        {holidays.data && (
          <ul className="divide-y divide-[color:var(--border)]">
            {holidays.data.length === 0 && <li className="py-2 text-sm text-muted">{t('hrFix.calendar.noHolidays')}</li>}
            {holidays.data.map((h) => (
              <li key={h.id} className="flex items-center justify-between py-2 text-sm">
                <span><b>{fmtDate(h.date)}</b> · {h.name}{h.depotId ? ` ${t('hrFix.calendar.depotScope')}` : ` ${t('hrFix.calendar.nationalScope')}`}</span>
                {isAdmin && <Button variant="ghost" onClick={() => delHoliday(h.id)}>{t('hrFix.calendar.delete')}</Button>}
              </li>
            ))}
          </ul>
        )}
        {isAdmin && (
          <div className="flex flex-wrap items-end gap-2 border-t border-app pt-3">
            <label className="text-sm">{t('hrFix.calendar.date')}<Input type="date" value={hDate} onChange={(e) => setHDate(e.target.value)} /></label>
            <label className="text-sm">{t('hrFix.calendar.name')}<Input value={hName} onChange={(e) => setHName(e.target.value)} placeholder={t('hrFix.calendar.holidayHint')} /></label>
            <Button onClick={addHoliday}>{t('hrFix.calendar.add')}</Button>
          </div>
        )}
      </Card>

      <Card className="space-y-3 p-5">
        <h3 className="font-bold">{t('hrFix.calendar.shift')}</h3>
        {shifts.loading && <Skeleton className="h-20" />}
        {/* The holiday list above already reports its own failure; this one said nothing,
            and "belum ada shift" is read as a depot that runs on the default hours. */}
        {shifts.error && <ErrorState message={shifts.error} onRetry={shifts.reload} />}
        {shifts.data && (
          <ul className="divide-y divide-[color:var(--border)]">
            {shifts.data.length === 0 && <li className="py-2 text-sm text-muted">Belum ada shift (pakai default {`{workStartTime}`}).</li>}
            {shifts.data.map((s) => (
              <li key={s.id} className="flex items-center justify-between py-2 text-sm">
                <span><b>{s.name}</b> · {s.startTime}–{s.endTime}{s.active ? '' : ` (${t('hrFix.calendar.inactive')})`}{s.depotId ? ` · ${t('hrFix.calendar.depot')}` : ''}</span>
                {isAdmin && (
                  <span className="flex shrink-0 gap-1">
                    <Button variant="ghost" onClick={() => toggleShift(s.id, s.active)}>
                      {s.active ? t('hrFix.calendar.deactivate') : t('hrFix.calendar.activate')}
                    </Button>
                    <Button variant="ghost" onClick={() => delShift(s.id)}>{t('hrFix.calendar.delete')}</Button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        {isAdmin && (
          <div className="flex flex-wrap items-end gap-2 border-t border-app pt-3">
            <label className="text-sm">{t('hrFix.calendar.name')}<Input value={sName} onChange={(e) => setSName(e.target.value)} placeholder={t('hrFix.calendar.shiftHint')} className="w-32" /></label>
            <label className="text-sm">{t('hrFix.calendar.start')}<Input type="time" value={sStart} onChange={(e) => setSStart(e.target.value)} /></label>
            <label className="text-sm">{t('hrFix.calendar.end')}<Input type="time" value={sEnd} onChange={(e) => setSEnd(e.target.value)} /></label>
            <Button onClick={addShift}>{t('hrFix.calendar.add')}</Button>
          </div>
        )}
      </Card>
    </div>
  );
}
