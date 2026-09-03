'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowDown, ArrowUp, BookOpen, Export, Lock, Plus, type Icon } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import {
  Button,
  Card,
  CenterState,
  Chip,
  ErrorState,
  Field,
  FormError,
  Input,
  Money,
  Skeleton,
} from '@/components/ui';
import { Sheet } from '@/components/overlay';
import { api, ApiError } from '@/lib/api';
import { downloadCsv, toCsv, type CsvCell } from '@/lib/csv';
import { downloadXlsx } from '@/lib/xlsx';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { can } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import { useT } from '@/lib/locale-context';
import type { CashDirection, CashbookEntry, CashbookResponse } from '@/lib/types';
import { todayWib } from '@/lib/wib';

const TODAY = new Intl.DateTimeFormat('id-ID', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
}).format(new Date());
const timeFmt = new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit' });
const startOfTodayIso = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
};

function StatCard({
  label,
  amount,
  variant,
}: {
  label: string;
  amount: number;
  variant: 'in' | 'out' | 'balance';
}) {
  if (variant === 'balance') {
    return (
      <Card className="flex flex-col gap-1 bg-brand-700 p-4 text-on-brand" elevated={false}>
        <p className="text-xs font-medium opacity-80">{label}</p>
        <Money amount={amount} className="text-lg font-extrabold" />
      </Card>
    );
  }
  const color = variant === 'in' ? 'text-[color:var(--success)]' : 'text-[color:var(--danger)]';
  return (
    <Card className="flex flex-col gap-1 p-4">
      <p className="text-xs font-medium text-[color:var(--text-muted)]">{label}</p>
      <span className={`text-lg font-extrabold tabular-nums ${color}`}>
        {variant === 'in' ? '+' : '−'}
        <Money amount={amount} />
      </span>
    </Card>
  );
}

/** Inline "Catat kas" form → POST an entry, then reload the ledger. */
function CreateForm({ depotId, onDone }: { depotId: string; onDone: () => void }) {
  const { t } = useT();
  const [direction, setDirection] = useState<CashDirection>('IN');
  const [category, setCategory] = useState('');
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const amountIdr = Number(amount);
    if (!category.trim() || !label.trim() || !Number.isFinite(amountIdr) || amountIdr <= 0) {
      setError(t('opsFix.cashbook.required'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post(
        endpoints.cashbook.create,
        { depotId, direction, category: category.trim(), label: label.trim(), amountIdr },
        true,
      );
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('opsFix.cashbook.saveError'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex gap-2">
        {(['IN', 'OUT'] as const).map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setDirection(d)}
            aria-pressed={direction === d}
          >
            <Chip tone={direction === d ? 'ink' : 'outline'}>
              {d === 'IN' ? t('opsFix.cashbook.in') : t('opsFix.cashbook.out')}
            </Chip>
          </button>
        ))}
      </div>
      <Field label={t('opsFix.cashbook.category')} htmlFor="cb-category">
        <Input
          id="cb-category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder={t('opsFix.cashbook.categoryPlaceholder')}
        />
      </Field>
      <Field label={t('opsFix.cashbook.note')} htmlFor="cb-label">
        <Input
          id="cb-label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={t('opsFix.cashbook.notePlaceholder')}
        />
      </Field>
      <Field label={t('opsFix.cashbook.amount')} htmlFor="cb-amount">
        <Input
          id="cb-amount"
          type="number"
          inputMode="numeric"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder={t('opsFix.cashbook.amountPlaceholder')}
        />
      </Field>
      {error && (
        <p className="text-sm font-medium text-red-600" role="alert">
          {error}
        </p>
      )}
      <div className="flex justify-end">
        <Button onClick={submit} loading={busy}>
          {t('opsFix.cashbook.save')}
        </Button>
      </div>
    </Card>
  );
}

function CashbookBody() {
  const { t } = useT();
  const { scopedId } = useDepot();
  const [showForm, setShowForm] = useState(false);
  /*
   * CA-2-22: the entry being corrected, and the reason for it.
   *
   * The route existed with no way in — `check-route-parity` caught that, and a correction
   * path nobody can reach from the console is the same class of bug as the one it fixes.
   */
  const [correcting, setCorrecting] = useState<CashbookEntry | null>(null);
  const [reason, setReason] = useState('');
  const [correctBusy, setCorrectBusy] = useState(false);
  const [correctError, setCorrectError] = useState<string | null>(null);

  async function submitCorrection() {
    if (!correcting || reason.trim().length < 4) {
      return setCorrectError(t('opsFix.cashbook.needReason'));
    }
    setCorrectBusy(true);
    setCorrectError(null);
    try {
      await api.post(endpoints.cashbook.reverse(correcting.id), { reason: reason.trim() }, true);
      setCorrecting(null);
      setReason('');
      book.reload();
    } catch (err) {
      setCorrectError(err instanceof ApiError ? err.message : t('opsFix.cashbook.correctError'));
    } finally {
      setCorrectBusy(false);
    }
  }

  const book = useAsync<CashbookResponse>(
    () =>
      scopedId
        ? api.get(endpoints.cashbook.list({ depotId: scopedId, from: startOfTodayIso() }), true)
        : Promise.resolve({ entries: [], summary: { inIdr: 0, outIdr: 0, netIdr: 0 } }),
    [scopedId],
  );

  const summary = book.data?.summary ?? { inIdr: 0, outIdr: 0, netIdr: 0 };
  // Newest first — server order isn't guaranteed, sort by occurredAt desc.
  const entries = [...(book.data?.entries ?? [])].sort(
    (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
  );

  /**
   * The day's ledger as a file. Built from what is already on screen — no export endpoint
   * involved, same as the daily depot report.
   *
   * Masuk/Keluar are separate columns rather than one signed column: that is the shape a
   * bookkeeper's sheet already has, and it makes the two SUMs at the bottom trivial.
   */
  function exportBook(format: 'csv' | 'xlsx') {
    const headers = ['Waktu', 'Kategori', 'Keterangan', 'Masuk', 'Keluar'];
    const rows: CsvCell[][] = entries.map((e) => [
      timeFmt.format(new Date(e.occurredAt)),
      e.category,
      e.label,
      e.direction === 'IN' ? e.amountIdr : '',
      e.direction === 'OUT' ? e.amountIdr : '',
    ]);
    const day = todayWib();
    if (format === 'csv') {
      downloadCsv(`buku-kas-${day}.csv`, toCsv(headers, rows));
      return;
    }
    return downloadXlsx(`buku-kas-${day}.xlsx`, headers, rows, 'Buku kas');
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <BookOpen size={24} weight="fill" className="text-brand-500" />
          <div>
            <h1 className="text-2xl font-bold">{t('opsFix.cashbook.title')}</h1>
            <p className="text-sm text-[color:var(--text-muted)]">{TODAY}</p>
          </div>
        </div>
        <Chip tone="tint">{t('opsFix.cashbook.today')}</Chip>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <StatCard label={t('opsFix.cashbook.in')} amount={summary.inIdr} variant="in" />
        <StatCard label={t('opsFix.cashbook.out')} amount={summary.outIdr} variant="out" />
        {/* ponytail: opening balance not tracked server-side, so this is net today (in − out), not a running balance. */}
        <StatCard label={t('opsFix.cashbook.net')} amount={summary.netIdr} variant="balance" />
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">{t('opsFix.cashbook.todayTx')}</p>
        <Button variant="secondary" onClick={() => setShowForm((v) => !v)}>
          <Plus size={16} weight="bold" />
          {t('opsFix.cashbook.record')}
        </Button>
      </div>

      {showForm && scopedId && (
        <CreateForm
          depotId={scopedId}
          onDone={() => {
            setShowForm(false);
            book.reload();
          }}
        />
      )}

      <Sheet
        open={correcting !== null}
        onClose={() => {
          setCorrecting(null);
          setReason('');
          setCorrectError(null);
        }}
        title={t('opsFix.cashbook.correctTitle')}
      >
        <div className="flex flex-col gap-3 pb-2">
          {/* The original stays; this posts its opposite. Saying so is the point — an
              operator who thinks they are deleting a row will not write a useful reason. */}
          <p className="text-sm text-muted">{t('opsFix.cashbook.correctBody')}</p>
          {correcting && (
            <p className="rounded-lg border border-app px-3 py-2 text-sm">
              <span className="font-semibold">{correcting.label}</span>
              <span className="ml-2 tabular-nums text-muted">
                {correcting.direction === 'IN' ? '+' : '−'}
                <Money amount={correcting.amountIdr} />
              </span>
            </p>
          )}
          <Field label={t('opsFix.cashbook.reason')} htmlFor="cb-reason">
            <Input
              id="cb-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t('opsFix.cashbook.reasonPlaceholder')}
            />
          </Field>
          <FormError message={correctError} />
          <Button onClick={submitCorrection} loading={correctBusy}>
            {t('opsFix.cashbook.correctConfirm')}
          </Button>
        </div>
      </Sheet>

      {book.loading ? (
        <Skeleton className="h-64 w-full" />
      ) : book.error ? (
        <ErrorState message={book.error} onRetry={book.reload} />
      ) : entries.length === 0 ? (
        <CenterState title={t('opsFix.cashbook.empty')} icon={<BookOpen size={40} weight="fill" />}>
          {t('opsFix.cashbook.emptyBody')}
        </CenterState>
      ) : (
        <Card className="flex flex-col divide-y divide-[color:var(--border)] p-0">
          {entries.map((e) => {
            const isIn = e.direction === 'IN';
            const ArrowIcon: Icon = isIn ? ArrowDown : ArrowUp;
            /*
             * CA-2-22: a correction is possible on an ordinary entry, once.
             *
             * A reversal cannot itself be reversed — undoing one is recording the original
             * again — and an entry that has already been corrected is done. Both are refused
             * by the server too; hiding the button is the courtesy on top of the rule.
             */
            const corrected = entries.some((x) => x.reversesId === e.id);
            const canCorrect = !e.reversesId && !corrected;
            return (
              <div key={e.id} className="flex items-center gap-3 p-4">
                <span
                  className={`flex size-9 shrink-0 items-center justify-center rounded-full ${
                    isIn
                      ? 'bg-[color:var(--success-bg)] text-[color:var(--success)]'
                      : 'bg-[color:var(--surface-soft)] text-[color:var(--danger)]'
                  }`}
                >
                  <ArrowIcon size={16} weight="bold" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{e.label}</p>
                  <p className="text-xs text-[color:var(--text-muted)]">
                    {timeFmt.format(new Date(e.occurredAt))} · {e.category}
                  </p>
                </div>
                <span
                  className={`shrink-0 text-sm font-semibold tabular-nums ${
                    isIn ? 'text-[color:var(--success)]' : 'text-[color:var(--danger)]'
                  }`}
                >
                  {isIn ? '+' : '−'}
                  <Money amount={e.amountIdr} />
                </span>
                {canCorrect && (
                  <button
                    type="button"
                    onClick={() => setCorrecting(e)}
                    className="shrink-0 rounded-lg border border-app px-2.5 py-1.5 text-xs font-bold text-muted transition-colors hover:border-brand-600 hover:text-brand-700"
                  >
                    {t('opsFix.cashbook.correct')}
                  </button>
                )}
              </div>
            );
          })}
        </Card>
      )}

      <div className="flex gap-3">
        <Button
          variant="secondary"
          className="flex-1"
          onClick={() => void exportBook('xlsx')}
          disabled={entries.length === 0}
        >
          <Export size={16} weight="bold" />
          {t('opsFix.cashbook.exportExcel')}
        </Button>
        <Button
          variant="secondary"
          className="flex-1"
          onClick={() => exportBook('csv')}
          disabled={entries.length === 0}
        >
          <Export size={16} weight="bold" />
          CSV
        </Button>
      </div>

      {/*
        "Tutup buku hari ini" used to sit here as a dead button beside the real one on the
        daily report. Two buttons for one irreversible action is how a depot closes the
        wrong date — and only the report page has the date picker, the "Buku ditutup"
        state and the late-entry warning that make the action safe to take.
      */}
      <p className="text-center text-[12.5px] text-[color:var(--text-muted)]">
        {t('opsFix.cashbook.closeBookAt')}{' '}
        <Link href="/dashboard/reports" className="font-semibold text-brand-600 hover:underline">
          {t('opsFix.cashbook.dailyReport')}
        </Link>
        .
      </p>
    </div>
  );
}

function Gate() {
  const { t } = useT();
  const { customer } = useAuth();
  if (!can('depotFinance', customer?.role)) {
    return (
      <CenterState title={t('opsFix.cashbook.gate')} icon={<Lock size={40} weight="fill" />}>
        {t('opsFix.cashbook.gateBody')}
      </CenterState>
    );
  }
  return <CashbookBody />;
}

export default function CashbookPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
