'use client';

import { useState } from 'react';
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
      toast('Shift dibuka.');
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Gagal membuka shift.', 'error');
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
      toast(e instanceof ApiError ? e.message : 'Gagal menutup shift.', 'error');
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
          <p className="font-semibold">Shift ditutup</p>
          <dl className="mt-1 space-y-1">
            <div className="flex justify-between">
              <dt className="text-muted">Seharusnya</dt>
              <dd><Money amount={settled.expectedCash ?? 0} /></dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Dihitung</dt>
              <dd><Money amount={settled.countedCash ?? 0} /></dd>
            </div>
            <div className="flex justify-between font-bold">
              <dt>Selisih</dt>
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
            <p className="font-semibold">Belum ada shift terbuka</p>
            <p className="text-sm text-muted">
              Buka shift dulu — penjualan konter ditolak selama laci belum ada penanggung jawabnya.
            </p>
          </div>
          <Field label="Uang kembalian awal di laci" htmlFor="shift-float">
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
                Tutup shift
              </Button>
            )}
          </div>

          {closing && (
            <div className="space-y-3 border-t border-[color:var(--border)] pt-3">
              {/* No expected figure is shown before counting on purpose: seeing the target
                  first turns a count into a confirmation, and a real shortfall disappears. */}
              <Field
                label="Uang tunai dihitung di laci"
                htmlFor="shift-counted"
                hint="Hitung dulu, baru masukkan. Selisih dihitung server."
              >
                <Input
                  id="shift-counted"
                  value={counted}
                  onChange={(e) => setCounted(e.target.value)}
                  inputMode="numeric"
                  placeholder="1450000"
                />
              </Field>
              <Field label="Catatan (opsional)" htmlFor="shift-note">
                <Input
                  id="shift-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Kembalian kurang Rp 2.000"
                />
              </Field>
              <div className="flex gap-2">
                <Button onClick={() => void close(current.id)} disabled={busy || !counted.trim()}>
                  Tutup &amp; hitung selisih
                </Button>
                <Button variant="ghost" onClick={() => setClosing(false)} disabled={busy}>
                  Batal
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
