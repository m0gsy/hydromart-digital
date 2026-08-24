'use client';

import { useMemo, useState } from 'react';
import { CaretDown, Lock, Money, Wallet } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Button, Card, CenterState, ErrorState, Field, Input, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { formatIDR } from '@/lib/format';
import { canVerifySettlement } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import { useT } from '@/lib/locale-context';
import type { CashSettlement, Customer, SettlementStatus } from '@/lib/types';

const STATUSES: SettlementStatus[] = ['SUBMITTED', 'VERIFIED', 'DISPUTED'];
// Keys, not copy — an enum-keyed label map is one of the shapes the i18n scanner could
// not read until it was widened.
const STATUS_LABEL: Record<SettlementStatus, string> = {
  SUBMITTED: 'opsFix.settlementStatus.SUBMITTED',
  VERIFIED: 'opsFix.settlementStatus.VERIFIED',
  DISPUTED: 'opsFix.settlementStatus.DISPUTED',
};
const TIME = new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit' });
const DAY = new Intl.DateTimeFormat('id-ID', { dateStyle: 'long' });

const shortId = (id: string) => id.slice(0, 8);
const initials = (id: string) => id.replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase();

/**
 * G-2: the courier's NAME. Three places on this screen rendered `driverId.slice(0, 8)` —
 * an id fragment as a person — while `endpoints.auth.drivers` is one cached read away.
 * `dashboard/commission` already builds this exact id→name map. Falls back to the short id
 * when the roster cannot be read, which is what the screen showed before.
 */
function useDriverNames(): (id: string) => string {
  const { t } = useT();
  const drivers = useAsync<Customer[]>(
    () => api.getCached<Customer[]>(endpoints.auth.drivers, true).catch(() => []),
    [],
  );
  return useMemo(() => {
    const byId = new Map((drivers.data ?? []).map((d) => [d.id, d.fullName || d.phone]));
    return (id: string) => byId.get(id) ?? t('opsFix.commission.unnamedCourier', { id: shortId(id) });
  }, [drivers.data, t]);
}

/**
 * The surplus above which the server refuses a verify without a note (C1).
 *
 * The label used to say "Rp5.000" as a literal beside a rule enforced from a constant in
 * delivery-service — two places holding one number, and this is the one nobody would
 * remember to change. `getCached` keeps it to one request no matter how many rows.
 */
function useSurplusThreshold(): number | null {
  const rules = useAsync<{ surplusNoteThresholdIdr: number }>(
    () => api.getCached(endpoints.settlements.rules, true),
    [],
  );
  return rules.data?.surplusNoteThresholdIdr ?? null;
}

function SettlementRow({
  s,
  onDone,
  driverName,
}: {
  s: CashSettlement;
  onDone: () => void;
  driverName: (id: string) => string;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<'verify' | 'dispute' | null>(null);
  const [charge, setCharge] = useState(true);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const surplusThreshold = useSurplusThreshold();

  const pending = s.status === 'SUBMITTED';
  const shortfall = s.variance < 0;

  const act = async (kind: 'verify' | 'dispute') => {
    if (kind === 'dispute' && note.trim() === '') {
      setError(t('opsFix.settlements.disputeReasonRequired'));
      return;
    }
    setBusy(kind);
    setError(null);
    try {
      if (kind === 'verify') {
        await api.post(endpoints.settlements.verify(s.id), { chargedToDriver: shortfall && charge, note: note.trim() || undefined }, true);
      } else {
        await api.post(endpoints.settlements.dispute(s.id), { note: note.trim() }, true);
      }
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('opsFix.settlements.actionError'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card
      className={`flex flex-col gap-3 p-4 ${pending ? 'border-[color:var(--warning)] bg-[color:var(--warning-bg)]' : ''}`}
    >
      {/* Identity + wajib-setor */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-bold text-brand-800"
          >
            {initials(s.driverId)}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold">{driverName(s.driverId)}</p>
            <p className="text-xs text-[color:var(--text-muted)]">
              {t('opsFix.settlements.ordersLine', {
                n: s.orderIds.length,
                time: TIME.format(new Date(s.createdAt)),
              })}
            </p>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-xs text-[color:var(--text-muted)]">{t('opsFix.settlements.expected')}</p>
          <p className="flex items-center justify-end gap-1 text-sm font-bold tabular-nums">
            <Money size={14} weight="fill" />
            {formatIDR(s.expectedAmount)}
          </p>
        </div>
      </div>

      {/* Pending → verify trigger + inline flow */}
      {pending ? (
        <>
          {!open ? (
            <Button onClick={() => setOpen(true)} className="w-full">
              {t('opsFix.settlements.countVerify')}
            </Button>
          ) : (
            <div className="flex flex-col gap-3 border-t border-app pt-3">
              <div
                className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-bold ${
                  shortfall
                    ? 'bg-[color:var(--danger-bg)] text-[color:var(--danger)]'
                    : 'bg-[color:var(--success-bg)] text-[color:var(--success)]'
                }`}
              >
                <Money size={16} weight="fill" />
                <span className="tabular-nums">
                  {t('opsFix.settlements.deposited')} {formatIDR(s.depositedAmount)}
                  {' · '}
                  {shortfall
                    ? t('opsFix.settlements.short', { amount: formatIDR(Math.abs(s.variance)) })
                    : s.variance > 0
                      ? t('opsFix.settlements.over', { amount: formatIDR(s.variance) })
                      : t('opsFix.settlements.exact')}
                </span>
              </div>

              {shortfall && (
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input type="checkbox" checked={charge} onChange={(e) => setCharge(e.target.checked)} />
                  {t('opsFix.settlements.chargeCourier', {
                    amount: formatIDR(Math.abs(s.variance)),
                  })}
                </label>
              )}
              <Field
                label={t('opsFix.settlements.note', {
                  amount: surplusThreshold == null ? '—' : formatIDR(surplusThreshold),
                })}
                htmlFor={`note-${s.id}`}
              >
                <Input id={`note-${s.id}`} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('opsFix.settlements.notePlaceholder')} />
              </Field>
              {error && <p className="text-sm font-medium text-[color:var(--danger)]">{error}</p>}
              <div className="flex gap-2">
                <Button onClick={() => act('verify')} loading={busy === 'verify'} className="flex-1">
                  {t('opsFix.settlements.verify')}
                </Button>
                <Button variant="ghost" onClick={() => act('dispute')} loading={busy === 'dispute'} className="flex-1">
                  {t('opsFix.settlements.dispute')}
                </Button>
              </div>
            </div>
          )}
        </>
      ) : (
        /* Verified / disputed → status chip + disetor + rincian */
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-bold ${
                  s.status === 'VERIFIED'
                    ? 'bg-[color:var(--success-bg)] text-[color:var(--success)]'
                    : 'bg-[color:var(--danger-bg)] text-[color:var(--danger)]'
                }`}
              >
                {t(STATUS_LABEL[s.status])}
              </span>
              <span className="text-sm font-bold tabular-nums">
                {t('opsFix.settlements.depositedAmount', { amount: formatIDR(s.depositedAmount) })}
              </span>
              {shortfall && (
                <span className="text-sm font-bold tabular-nums text-[color:var(--danger)]">
                  {t('opsFix.settlements.shortAmount', {
                    amount: formatIDR(Math.abs(s.variance)),
                  })}
                </span>
              )}
            </div>
            <Button variant="secondary" onClick={() => setOpen((v) => !v)} className="px-3 py-1.5 text-xs">
              {t('opsFix.settlements.details')}
              <CaretDown size={12} weight="bold" className={open ? 'rotate-180 transition-transform' : 'transition-transform'} />
            </Button>
          </div>
          {open && (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 border-t border-app pt-2 text-xs">
              <dt className="text-[color:var(--text-muted)]">{t('opsFix.settlements.dtExpected')}</dt>
              <dd className="text-right font-medium tabular-nums">{formatIDR(s.expectedAmount)}</dd>
              <dt className="text-[color:var(--text-muted)]">{t('opsFix.settlements.dtDeposited')}</dt>
              <dd className="text-right font-medium tabular-nums">{formatIDR(s.depositedAmount)}</dd>
              <dt className="text-[color:var(--text-muted)]">{t('opsFix.settlements.dtVariance')}</dt>
              <dd className="text-right font-medium tabular-nums">{formatIDR(s.variance)}</dd>
              {shortfall && (
                <>
                  <dt className="text-[color:var(--text-muted)]">{t('opsFix.settlements.dtCharged')}</dt>
                  <dd className="text-right font-medium">
                    {s.chargedToDriver ? t('opsFix.settlements.yes') : t('opsFix.settlements.no')}
                  </dd>
                </>
              )}
              {s.note && (
                <>
                  <dt className="text-[color:var(--text-muted)]">{t('opsFix.settlements.dtNote')}</dt>
                  <dd className="text-right font-medium">{s.note}</dd>
                </>
              )}
            </dl>
          )}
        </div>
      )}
    </Card>
  );
}

function Body() {
  const { t } = useT();
  const { scopedId, selected } = useDepot();
  const [status, setStatus] = useState<SettlementStatus>('SUBMITTED');
  const driverName = useDriverNames();
  const list = useAsync<CashSettlement[]>(
    () => (scopedId ? api.get(endpoints.settlements.list({ depotId: scopedId, status }), true) : Promise.resolve([])),
    [scopedId, status],
  );

  const waiting = list.data?.filter((s) => s.status === 'SUBMITTED').length ?? 0;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <Wallet size={24} weight="fill" className="text-brand-500" />
          <h1 className="text-2xl font-bold">{t('opsFix.settlements.title')}</h1>
        </div>
        <p className="text-sm text-[color:var(--text-muted)]">
          {t('opsFix.settlements.shiftLine', { date: DAY.format(new Date()), n: waiting })}
        </p>
        <p className="text-sm text-[color:var(--text-muted)]">
          {selected ? t('opsFix.common.depotNamed', { name: selected.name }) : t('opsFix.settlements.depotHint')}
        </p>
      </header>

      <div className="flex items-center gap-2">
        <label htmlFor="s-filter" className="text-sm font-medium text-[color:var(--text-muted)]">
          Status
        </label>
        <select
          id="s-filter"
          value={status}
          onChange={(e) => setStatus(e.target.value as SettlementStatus)}
          className="rounded-xl border border-app bg-transparent px-3 py-2 text-sm font-medium"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(STATUS_LABEL[s])}
            </option>
          ))}
        </select>
      </div>

      {list.loading ? (
        <Skeleton className="h-64 w-full" />
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : !list.data || list.data.length === 0 ? (
        <CenterState title={t('opsFix.settlements.empty')} icon={<Wallet size={40} weight="fill" />}>
          {t('opsFix.settlements.emptyBody', { status: t(STATUS_LABEL[status]).toLowerCase() })}
        </CenterState>
      ) : (
        <div className="flex flex-col gap-2.5">
          {list.data.map((s) => (
            <SettlementRow key={s.id} s={s} onDone={list.reload} driverName={driverName} />
          ))}
        </div>
      )}

      <Card className="bg-brand-50 p-4 text-sm text-[color:var(--text-muted)]" elevated={false}>
        {t('opsFix.settlements.footer')}
      </Card>
    </div>
  );
}

function Gate() {
  const { t } = useT();
  const { customer } = useAuth();
  if (!canVerifySettlement(customer?.role)) {
    return (
      <CenterState title={t('opsFix.settlements.gate')} icon={<Lock size={40} weight="fill" />}>
        {t('opsFix.settlements.gateBody')}
      </CenterState>
    );
  }
  return <Body />;
}

export default function SettlementsPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
