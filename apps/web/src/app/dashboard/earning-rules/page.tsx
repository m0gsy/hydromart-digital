'use client';

import { useState } from 'react';
import { Coins, Lock, Plus } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Badge, Button, Card, CenterState, ErrorState, Field, Input, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { formatIDR } from '@/lib/format';
import { canManageEarningRules } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import { useT } from '@/lib/locale-context';
import type { CourierEarningRule, Depot } from '@/lib/types';
import { todayWib } from '@/lib/wib';

const DATE = new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium' });

function selectClass() {
  return 'w-full rounded-xl border border-app bg-transparent px-3 py-2.5 text-sm font-medium';
}

function todayIso(): string {
  return todayWib();
}

function ApplyForm({ depots, onSaved }: { depots: Depot[]; onSaved: () => void }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [depotId, setDepotId] = useState('');
  const [baseFare, setBaseFare] = useState('5000');
  const [peakBonus, setPeakBonus] = useState('2000');
  const [onTimeBonus, setOnTimeBonus] = useState('1000');
  const [peakStartHour, setPeakStartHour] = useState('17');
  const [peakEndHour, setPeakEndHour] = useState('20');
  const [monthlyTarget, setMonthlyTarget] = useState('5000000');
  // Fixed three rungs — a blank count drops the rung. ponytail: add/remove rows only if
  // finance ever needs more than three.
  const [tiers, setTiers] = useState([
    { deliveries: '', bonus: '' },
    { deliveries: '', bonus: '' },
    { deliveries: '', bonus: '' },
  ]);
  const [effectiveDate, setEffectiveDate] = useState(todayIso());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api.post(
        endpoints.earningRules.apply,
        {
          depotId: depotId || undefined,
          baseFare: Number(baseFare),
          peakBonus: Number(peakBonus),
          onTimeBonus: Number(onTimeBonus),
          peakStartHour: Number(peakStartHour),
          peakEndHour: Number(peakEndHour),
          monthlyTarget: Number(monthlyTarget) || 0,
          tiers: tiers
            .filter((t) => Number(t.deliveries) > 0)
            .map((t) => ({ deliveries: Number(t.deliveries), bonus: Number(t.bonus) || 0 })),
          effectiveDate,
        },
        true,
      );
      setOpen(false);
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('opsFix.earningRules.saveError'));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)}>
        <Plus size={16} weight="bold" className="mr-1.5" />
        {t('opsFix.earningRules.newRule')}
      </Button>
    );
  }

  return (
    <Card className="flex flex-col gap-3 p-4">
      <p className="font-semibold">{t('opsFix.earningRules.applyTitle')}</p>
      <p className="text-xs text-muted">{t('opsFix.earningRules.applyHint')}</p>
      <Field label={t('opsFix.earningRules.scope')} htmlFor="er-depot">
        <select id="er-depot" value={depotId} onChange={(e) => setDepotId(e.target.value)} className={selectClass()}>
          <option value="">{t('opsFix.earningRules.networkDefault')}</option>
          {depots.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t('opsFix.earningRules.baseFare')} htmlFor="er-base">
          <Input id="er-base" type="number" value={baseFare} onChange={(e) => setBaseFare(e.target.value)} />
        </Field>
        <Field label={t('opsFix.earningRules.peakBonus')} htmlFor="er-peak">
          <Input id="er-peak" type="number" value={peakBonus} onChange={(e) => setPeakBonus(e.target.value)} />
        </Field>
        <Field label={t('opsFix.earningRules.onTimeBonus')} htmlFor="er-ontime">
          <Input id="er-ontime" type="number" value={onTimeBonus} onChange={(e) => setOnTimeBonus(e.target.value)} />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t('opsFix.earningRules.monthlyTarget')} htmlFor="er-target">
          <Input id="er-target" type="number" min={0} value={monthlyTarget} onChange={(e) => setMonthlyTarget(e.target.value)} />
        </Field>
        <Field label={t('opsFix.earningRules.peakStart')} htmlFor="er-start">
          <Input id="er-start" type="number" min={0} max={23} value={peakStartHour} onChange={(e) => setPeakStartHour(e.target.value)} />
        </Field>
        <Field label={t('opsFix.earningRules.peakEnd')} htmlFor="er-end">
          <Input id="er-end" type="number" min={1} max={24} value={peakEndHour} onChange={(e) => setPeakEndHour(e.target.value)} />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('opsFix.earningRules.effectiveFrom')} htmlFor="er-date">
          <Input id="er-date" type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
        </Field>
      </div>
      <p className="text-xs font-semibold">{t('opsFix.earningRules.tiersTitle')}</p>
      <div className="flex flex-col gap-2">
        {tiers.map((tier, i) => (
          <div key={i} className="grid gap-3 sm:grid-cols-2">
            <Field
              label={t('opsFix.earningRules.tierDeliveries', { n: i + 1 })}
              htmlFor={`er-tier-n-${i}`}
            >
              <Input
                id={`er-tier-n-${i}`}
                type="number"
                min={1}
                value={tier.deliveries}
                onChange={(e) => setTiers((prev) => prev.map((t, j) => (i === j ? { ...t, deliveries: e.target.value } : t)))}
              />
            </Field>
            <Field
              label={t('opsFix.earningRules.tierBonus', { n: i + 1 })}
              htmlFor={`er-tier-b-${i}`}
            >
              <Input
                id={`er-tier-b-${i}`}
                type="number"
                min={0}
                value={tier.bonus}
                onChange={(e) => setTiers((prev) => prev.map((t, j) => (i === j ? { ...t, bonus: e.target.value } : t)))}
              />
            </Field>
          </div>
        ))}
      </div>
      {error && <p className="text-sm font-medium text-red-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
          {t('opsFix.earningRules.cancel')}
        </Button>
        <Button onClick={submit} loading={busy}>
          {t('opsFix.earningRules.apply')}
        </Button>
      </div>
    </Card>
  );
}

function RuleRow({ r, depotName }: { r: CourierEarningRule; depotName: string }) {
  const { t } = useT();
  return (
    <Card className="flex flex-col gap-2 p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="font-semibold">{depotName}</span>
        <Badge tone={r.depotId ? 'brand' : 'neutral'}>
          {r.depotId ? t('opsFix.earningRules.badgeDepot') : t('opsFix.earningRules.badgeDefault')}
        </Badge>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <span>
          {t('opsFix.earningRules.rowBase')} <strong className="tabular-nums">{formatIDR(r.baseFare)}</strong>
        </span>
        <span>
          {t('opsFix.earningRules.rowPeak')} <strong className="tabular-nums">+{formatIDR(r.peakBonus)}</strong> (
          {r.peakStartHour}–{r.peakEndHour})
        </span>
        <span>
          {t('opsFix.earningRules.rowOnTime')} <strong className="tabular-nums">+{formatIDR(r.onTimeBonus)}</strong>
        </span>
      </div>
      {r.monthlyTarget > 0 && (
        <p className="text-sm">
          {t('opsFix.earningRules.rowTarget')} <strong className="tabular-nums">{formatIDR(r.monthlyTarget)}</strong>
        </p>
      )}
      {r.tiers.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {r.tiers.map((tier) => (
            <span key={tier.deliveries}>
              {t('opsFix.earningRules.rowTier', { n: tier.deliveries })}{' '}
              <strong className="tabular-nums">+{formatIDR(tier.bonus)}</strong>
            </span>
          ))}
        </div>
      )}
      <p className="text-xs text-muted">
        {t('opsFix.earningRules.rowEffective', { date: DATE.format(new Date(r.effectiveDate)) })}
      </p>
    </Card>
  );
}

function Body() {
  const { t } = useT();
  const { depots } = useDepot();
  const list = useAsync<CourierEarningRule[]>(() => api.get(endpoints.earningRules.list, true), []);
  const depotName = (id: string | null) =>
    id ? (depots.find((d) => d.id === id)?.name ?? id) : t('opsFix.earningRules.defaultName');

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Coins size={24} weight="fill" className="text-brand-500" />
          <h1 className="text-2xl font-bold">{t('opsFix.earningRules.title')}</h1>
        </div>
        <ApplyForm depots={depots} onSaved={list.reload} />
      </div>

      {list.loading ? (
        <Skeleton className="h-64 w-full" />
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : !list.data || list.data.length === 0 ? (
        <CenterState title={t('opsFix.earningRules.empty')} icon={<Coins size={40} weight="fill" />}>
          {t('opsFix.earningRules.emptyBody')}
        </CenterState>
      ) : (
        <div className="flex flex-col gap-2.5">
          {list.data.map((r) => (
            <RuleRow key={r.id} r={r} depotName={depotName(r.depotId)} />
          ))}
        </div>
      )}
    </div>
  );
}

function Gate() {
  const { t } = useT();
  const { customer } = useAuth();
  if (!canManageEarningRules(customer?.role)) {
    return (
      <CenterState title={t('opsFix.earningRules.gate')} icon={<Lock size={40} weight="fill" />}>
        {t('opsFix.earningRules.gateBody')}
      </CenterState>
    );
  }
  return <Body />;
}

export default function EarningRulesPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
