'use client';

import { useState } from 'react';
import { Lightbulb, Lock, Target } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import {
  Button,
  Card,
  CenterState,
  ErrorState,
  Field,
  Input,
  LoadError,
  Skeleton,
} from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { formatIDR } from '@/lib/format';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { can } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import { useT } from '@/lib/locale-context';
import type { DepotTarget, ReportDepotMonthly } from '@/lib/types';

const now = new Date();
const MONTH = new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' }).format(now);
const DAY = now.getDate();
const DAYS_IN_MONTH = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
const MONTH_KEY = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
const PACE = DAY / DAYS_IN_MONTH; // fraction of the month elapsed

type Goal = {
  label: string;
  /** null = no real actual available yet (shown as "—"). */
  actual: number | null;
  target: number;
  money?: boolean;
  /** rate metric (%) — compared to target directly, not against month pace. */
  rate?: boolean;
};

function fmtValue(v: number | null, g: Goal): string {
  if (v == null) return '—';
  if (g.money) return formatIDR(v);
  if (g.rate) return `${v}%`;
  return v.toLocaleString('id-ID');
}

function GoalBar({ goal }: { goal: Goal }) {
  const pct = goal.target > 0 && goal.actual != null ? (goal.actual / goal.target) * 100 : 0;
  // Cumulative metrics: behind if below the linear month pace. Rate metrics: behind if under target.
  const behind =
    goal.actual != null &&
    (goal.rate ? goal.actual < goal.target : pct < PACE * 100);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-semibold">{goal.label}</span>
        <span className="text-sm tabular-nums text-[color:var(--text-muted)]">
          <strong className="text-[color:var(--text)]">{fmtValue(goal.actual, goal)}</strong> /{' '}
          {fmtValue(goal.target, goal)}
        </span>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-[color:var(--surface-soft)]">
        <div
          className={`h-full rounded-full ${behind ? 'bg-amber-500' : 'bg-brand-600'}`}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
    </div>
  );
}

/** Ubah target — PUT upsert of the 4 targets, then reload. */
function TargetForm({
  depotId,
  current,
  onDone,
  onCancel,
}: {
  depotId: string;
  current: DepotTarget | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { t } = useT();
  const [revenue, setRevenue] = useState(String(current?.revenueTargetIdr ?? ''));
  const [orders, setOrders] = useState(String(current?.ordersTarget ?? ''));
  const [sla, setSla] = useState(String(current?.slaTargetPct ?? ''));
  const [newCustomers, setNewCustomers] = useState(String(current?.newCustomersTarget ?? ''));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const body = {
      depotId,
      month: MONTH_KEY,
      revenueTargetIdr: Number(revenue),
      ordersTarget: Number(orders),
      slaTargetPct: Number(sla),
      newCustomersTarget: Number(newCustomers),
    };
    if (Object.values(body).some((v) => typeof v === 'number' && !Number.isFinite(v))) {
      setError(t('hrFix.depotTargets.mustBeNumbers'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.put(endpoints.depotTargets.upsert, body, true);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('opsFix.targets.saveError'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4 p-5">
      <p className="font-semibold">{t('opsFix.targets.editTitle', { month: MONTH })}</p>
      <Field label={t('opsFix.targets.revenue')} htmlFor="t-revenue">
        <Input id="t-revenue" type="number" inputMode="numeric" value={revenue} onChange={(e) => setRevenue(e.target.value)} />
      </Field>
      <Field label={t('opsFix.targets.orders')} htmlFor="t-orders">
        <Input id="t-orders" type="number" inputMode="numeric" value={orders} onChange={(e) => setOrders(e.target.value)} />
      </Field>
      <Field label={t('opsFix.targets.sla')} htmlFor="t-sla">
        <Input id="t-sla" type="number" inputMode="numeric" value={sla} onChange={(e) => setSla(e.target.value)} />
      </Field>
      <Field label={t('opsFix.targets.newCustomers')} htmlFor="t-newcust">
        <Input id="t-newcust" type="number" inputMode="numeric" value={newCustomers} onChange={(e) => setNewCustomers(e.target.value)} />
      </Field>
      {error && (
        <p className="text-sm font-medium text-red-600" role="alert">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          {t('opsFix.targets.cancel')}
        </Button>
        <Button onClick={submit} loading={busy}>
          {t('opsFix.targets.save')}
        </Button>
      </div>
    </Card>
  );
}

function TargetsBody() {
  const { t } = useT();
  const { scopedId } = useDepot();
  const [editing, setEditing] = useState(false);

  const target = useAsync<DepotTarget | null>(
    () =>
      scopedId
        ? api.get(endpoints.depotTargets.get({ depotId: scopedId, month: MONTH_KEY }), true)
        : Promise.resolve(null),
    [scopedId],
  );
  // Real actuals from the monthly ops report (orders/revenue/sla). New-customer count is
  // not in this report, so it stays "—" rather than fabricated.
  const actuals = useAsync<ReportDepotMonthly>(
    () =>
      scopedId
        ? api.get(endpoints.reports.depotMonthly(scopedId, MONTH_KEY), true)
        : Promise.resolve({
            depotId: '',
            month: MONTH_KEY,
            orders: 0,
            revenueIdr: 0,
            activeCustomers: 0,
            netProfitIdr: null,
            profitBreakdown: { revenueIdr: 0, cogsIdr: null, opexIdr: null, payrollIdr: null },
            slaPct: null,
            gallons: 0,
            prevGallons: 0,
            gallonsDelta: 0,
            growthPct: null,
            avgGallonsPerDay: 0,
            governance: null,
          }),
    [scopedId],
  );

  const reloadAll = () => {
    target.reload();
    actuals.reload();
  };

  const header = (
    <div className="flex items-center gap-2">
      <Target size={24} weight="fill" className="text-brand-500" />
      <div>
        <h1 className="text-2xl font-bold">{t('opsFix.targets.title')}</h1>
        <p className="text-sm text-[color:var(--text-muted)]">
          {t('opsFix.targets.headerSub', { month: MONTH, day: DAY, days: DAYS_IN_MONTH })}
        </p>
      </div>
    </div>
  );

  if (target.loading) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-5">
        {header}
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (target.error) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-5">
        {header}
        <ErrorState message={target.error} onRetry={reloadAll} />
      </div>
    );
  }

  // No target row yet → prompt to set one (or show the form once opened).
  if (!target.data) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-5">
        {header}
        {editing && scopedId ? (
          <TargetForm
            depotId={scopedId}
            current={null}
            onCancel={() => setEditing(false)}
            onDone={() => {
              setEditing(false);
              reloadAll();
            }}
          />
        ) : (
          <CenterState title={t('opsFix.targets.empty')} icon={<Target size={40} weight="fill" />}>
            <p className="mb-4">{t('opsFix.targets.emptyBody', { month: MONTH })}</p>
            <Button onClick={() => setEditing(true)}>{t('opsFix.targets.setNow')}</Button>
          </CenterState>
        )}
      </div>
    );
  }

  const tgt = target.data;
  const a = actuals.data;
  const goals: Goal[] = [
    {
      label: t('opsFix.targets.goalRevenue'),
      actual: a?.revenueIdr ?? null,
      target: tgt.revenueTargetIdr,
      money: true,
    },
    { label: t('opsFix.targets.goalOrders'), actual: a?.orders ?? null, target: tgt.ordersTarget },
    { label: t('opsFix.targets.sla'), actual: a?.slaPct ?? null, target: tgt.slaTargetPct, rate: true },
    // ponytail: no new-customer count in depot-monthly report; wire when a report exposes it.
    { label: t('opsFix.targets.newCustomers'), actual: null, target: tgt.newCustomersTarget },
  ];

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      {header}

      {/* The target column survives an unread `actuals`; the achievement column does not,
          and a bar at zero progress against a target is a judgement about the depot. */}
      {actuals.error && <LoadError onRetry={actuals.reload} />}

      {editing && scopedId ? (
        <TargetForm
          depotId={scopedId}
          current={tgt}
          onCancel={() => setEditing(false)}
          onDone={() => {
            setEditing(false);
            reloadAll();
          }}
        />
      ) : (
        <>
          <Card className="flex flex-col gap-5 p-5">
            {goals.map((g) => (
              <GoalBar key={g.label} goal={g} />
            ))}
          </Card>

          <div className="flex justify-end">
            <Button variant="secondary" onClick={() => setEditing(true)}>
              Ubah target
            </Button>
          </div>

          <Card className="flex items-start gap-3 bg-brand-50 p-4">
            <Lightbulb size={22} weight="fill" className="mt-0.5 shrink-0 text-brand-700" />
            <div>
              <p className="font-semibold text-brand-800">{t('opsFix.targets.insight')}</p>
              <p className="text-[12.5px] text-brand-800/80">
                {t('opsFix.targets.insightBody', { day: DAY, days: DAYS_IN_MONTH })}
              </p>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function Gate() {
  const { t } = useT();
  const { customer } = useAuth();
  if (!can('depotTargets', customer?.role)) {
    return (
      <CenterState title={t('opsFix.targets.gate')} icon={<Lock size={40} weight="fill" />}>
        {t('opsFix.targets.gateBody')}
      </CenterState>
    );
  }
  return <TargetsBody />;
}

export default function TargetsPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
