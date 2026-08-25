'use client';

import { useState, useEffect } from 'react';
import { useT } from '@/lib/locale-context';
import { LockKey, LockKeyOpen } from '@phosphor-icons/react';

import { useToast } from '@/components/toast';
import { Button, Card, Field, Input, LoadError, Money, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAsync } from '@/lib/use-async';
import type { CashierShift } from '@/lib/types';

/**
 * The counter's chain of custody, shown above the sale form.
 *
 * A shift is not a formality here: the server refuses a counter sale while the cashier has
 * none open, so this bar is the only way onto the till. The expected total at close is read
 * from the payments themselves — the cashier enters what they counted, never what they owe.
 */
export function CashierShiftBar({
  depotId,
  onChange,
}: {
  depotId: string;
  /** Lets the sale form disable itself the moment the drawer closes. */
  onChange?: (shift: CashierShift | null) => void;
}) {
  const { t } = useT();
  const { toast } = useToast();
  const [float, setFloat] = useState('');
  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [closing, setClosing] = useState(false);
  const [settled, setSettled] = useState<CashierShift | null>(null);

  const shift = useAsync<CashierShift | null>(
    () => api.get(endpoints.cashierShifts.current(depotId), true),
    [depotId],
  );

  /*
   * K3.3. `onChange` used to fire only when THIS component opened or closed a shift, never
   * when it merely READ one. So a cashier arriving at a till whose shift was opened
   * earlier — the ordinary case, every morning after the first sale — left the page
   * believing the shift status was still unknown.
   *
   * That was survivable while "unknown" was treated as "probably open". It is not
   * survivable now that the pay button waits for a real answer: without this the button
   * would never enable for anybody who did not open their shift in this very tab.
   */
  const reported = shift.data;
  useEffect(() => {
    if (!shift.loading && !shift.error) onChange?.(reported ?? null);
  }, [reported, shift.loading, shift.error, onChange]);

  async function refresh(next: CashierShift | null) {
    onChange?.(next);
    await shift.reload();
  }

  async function open() {
    setBusy(true);
    try {
      const created = await api.post<CashierShift>(
        endpoints.cashierShifts.open,
        { depotId, openingFloat: Number(float.replace(/\D/g, '')) || 0 },
        true,
      );
      setFloat('');
      setSettled(null);
      await refresh(created);
      toast(t('hrFix.cashierShift.opened'));
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t('hrFix.cashierShift.openFailed'), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function close(id: string) {
    setBusy(true);
    try {
      const closed = await api.post<CashierShift>(
        endpoints.cashierShifts.close(id),
        { countedCash: Number(counted.replace(/\D/g, '')) || 0, note: note.trim() || undefined },
        true,
      );
      setCounted('');
      setNote('');
      setClosing(false);
      // Kept on screen after the drawer is gone: the variance is the one number the
      // cashier has to see, and reloading would replace it with an empty counter.
      setSettled(closed);
      await refresh(null);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t('hrFix.cashierShift.closeFailed'), 'error');
    } finally {
      setBusy(false);
    }
  }

  if (shift.loading) return <Skeleton className="h-24" />;

  const current = shift.data;

  return (
    <Card className="space-y-3 p-4">
      {settled && !current && (
        <div className="rounded-xl border border-app p-3 text-sm">
          <p className="font-semibold">{t('hrFix.cashierShift.closed')}</p>
          <dl className="mt-1 space-y-1">
            <div className="flex justify-between">
              <dt className="text-muted">{t('hrFix.cashierShift.expected')}</dt>
              <dd><Money amount={settled.expectedCash ?? 0} /></dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">{t('hrFix.cashierShift.counted')}</dt>
              <dd><Money amount={settled.countedCash ?? 0} /></dd>
            </div>
            <div className="flex justify-between font-bold">
              <dt>{t('hrFix.cashierShift.difference')}</dt>
              <dd className={(settled.variance ?? 0) < 0 ? 'text-red-600' : undefined}>
                <Money amount={settled.variance ?? 0} />
              </dd>
            </div>
          </dl>
        </div>
      )}

      {shift.error ? (
        // "Belum ada shift terbuka" invites the cashier to open a SECOND one. An unread
        // shift is not an absent shift, and the till is the thing being counted.
        <LoadError onRetry={shift.reload} />
      ) : !current ? (
        <div className="space-y-3">
          <div>
            <p className="font-semibold">{t('hrFix.cashierShift.noneOpen')}</p>
            <p className="text-sm text-muted">
              {t('hrFix.cashierShift.openFirst')}
            </p>
          </div>
          <Field label={t('hrFix.cashierShift.openingFloat')} htmlFor="shift-float">
            <Input
              id="shift-float"
              value={float}
              onChange={(e) => setFloat(e.target.value)}
              inputMode="numeric"
              placeholder="200000"
            />
          </Field>
          <Button onClick={() => void open()} disabled={busy}>
            <LockKeyOpen size={18} className="mr-1" />
            Buka shift
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-semibold">Shift terbuka — {current.cashierName}</p>
              <p className="text-sm text-muted">
                Modal awal <Money amount={current.openingFloat} /> · sejak{' '}
                {new Date(current.openedAt).toLocaleTimeString('id-ID', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </p>
            </div>
            {!closing && (
              <Button variant="ghost" onClick={() => setClosing(true)}>
                <LockKey size={18} className="mr-1" />
                {t('hrFix.cashierShift.closeShift2')}
              </Button>
            )}
          </div>

          {closing && (
            <div className="space-y-3 border-t border-[color:var(--border)] pt-3">
              {/* No expected figure is shown before counting on purpose: seeing the target
                  first turns a count into a confirmation, and a real shortfall disappears. */}
              <Field
                label={t('hrFix.cashierShift.countedCash')}
                htmlFor="shift-counted"
                hint={t('hrFix.cashierShift.countedHint')}
              >
                <Input
                  id="shift-counted"
                  value={counted}
                  onChange={(e) => setCounted(e.target.value)}
                  inputMode="numeric"
                  placeholder="1450000"
                />
              </Field>
              <Field label={t('hrFix.cashierShift.noteOpt')} htmlFor="shift-note">
                <Input
                  id="shift-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={t('hrFix.cashierShift.noteHint')}
                />
              </Field>
              <div className="flex gap-2">
                <Button onClick={() => void close(current.id)} disabled={busy || !counted.trim()}>
                  Tutup &amp; hitung selisih
                </Button>
                <Button variant="ghost" onClick={() => setClosing(false)} disabled={busy}>
                  {t('hrFix.cashierShift.cancel2')}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
