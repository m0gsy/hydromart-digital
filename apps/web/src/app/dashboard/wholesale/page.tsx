'use client';

import { useMemo, useState } from 'react';
import { Info, Lock, Stack } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import {
  Badge,
  Button,
  Card,
  CenterState,
  ErrorState,
  Field,
  Input,
  Money,
  Skeleton,
} from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { useT, type TVars } from '@/lib/locale-context';
import { can } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import type { WholesaleTier } from '@/lib/types';

/** "1–9 galon" / "50+ galon" from a tier's quantity band. */
function rangeLabel(tier: WholesaleTier, t: (key: string, vars?: TVars) => string): string {
  return tier.maxQty == null
    ? t('dashC.wholesale.rangeOpen', { min: tier.minQty })
    : t('dashC.wholesale.rangeBand', { min: tier.minQty, max: tier.maxQty });
}

/** Shared create/edit form. `tier` present → PATCH; absent → POST. */
function TierForm({
  depotId,
  tier,
  onDone,
  onCancel,
}: {
  depotId: string;
  tier?: WholesaleTier;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { t } = useT();
  const [label, setLabel] = useState(tier?.label ?? '');
  const [minQty, setMinQty] = useState(tier ? String(tier.minQty) : '');
  const [maxQty, setMaxQty] = useState(tier?.maxQty != null ? String(tier.maxQty) : '');
  const [priceIdr, setPriceIdr] = useState(tier ? String(tier.priceIdr) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const min = Number(minQty);
    const price = Number(priceIdr);
    if (!label.trim() || !Number.isFinite(min) || min < 1 || !Number.isFinite(price) || price <= 0) {
      setError(t('dashC.wholesale.invalidBasic'));
      return;
    }
    const max = maxQty.trim() ? Number(maxQty) : null;
    if (max != null && (!Number.isFinite(max) || max < min)) {
      setError(t('dashC.wholesale.invalidMax'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (tier) {
        await api.patch(
          endpoints.wholesale.detail(tier.id),
          { label: label.trim(), minQty: min, maxQty: max, priceIdr: price },
          true,
        );
      } else {
        await api.post(
          endpoints.wholesale.create,
          { depotId, label: label.trim(), minQty: min, maxQty: max, priceIdr: price },
          true,
        );
      }
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('dashC.wholesale.saveError'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4 p-5">
      <h2 className="font-semibold">{tier ? t('dashC.wholesale.editTitle') : t('dashC.wholesale.newTitle')}</h2>
      <Field label={t('dashC.wholesale.label')} htmlFor="w-label" hint={t('dashC.wholesale.labelHint')}>
        <Input id="w-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t('dashC.wholesale.labelPlaceholder')} />
      </Field>
      <div className="flex flex-wrap gap-3">
        <Field label={t('dashC.wholesale.minQty')} htmlFor="w-min">
          <Input
            id="w-min"
            type="number"
            inputMode="numeric"
            min={1}
            value={minQty}
            onChange={(e) => setMinQty(e.target.value)}
            placeholder="10"
          />
        </Field>
        <Field label={t('dashC.wholesale.maxQty')} htmlFor="w-max" hint={t('dashC.wholesale.maxQtyHint')}>
          <Input
            id="w-max"
            type="number"
            inputMode="numeric"
            value={maxQty}
            onChange={(e) => setMaxQty(e.target.value)}
            placeholder="49"
          />
        </Field>
      </div>
      <Field label={t('dashC.wholesale.price')} htmlFor="w-price">
        <Input
          id="w-price"
          type="number"
          inputMode="numeric"
          min={1}
          value={priceIdr}
          onChange={(e) => setPriceIdr(e.target.value)}
          placeholder="17500"
        />
      </Field>
      {error && (
        <p className="text-sm font-medium text-red-600" role="alert">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          {t('dashC.wholesale.cancel')}
        </Button>
        <Button onClick={submit} loading={busy}>
          {t('dashC.wholesale.save')}
        </Button>
      </div>
    </Card>
  );
}

function TierRow({ tier, best, onChanged }: { tier: WholesaleTier; best: boolean; onChanged: () => void }) {
  const { t } = useT();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const { scopedId } = useDepot();

  async function remove() {
    setBusy(true);
    try {
      await api.del(endpoints.wholesale.detail(tier.id), true);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <TierForm
        depotId={scopedId ?? tier.depotId}
        tier={tier}
        onDone={() => {
          setEditing(false);
          onChanged();
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <div
      className={`flex items-center justify-between gap-3 rounded-xl border p-4 ${
        best ? 'border-2 border-brand-500 bg-brand-50' : 'border-app'
      }`}
    >
      <div className="min-w-0">
        <p className="font-semibold">{rangeLabel(tier, t)}</p>
        <p className="text-xs text-muted">
          {tier.label}
          {best && (
            <>
              {' · '}
              <span className="font-semibold text-brand-700">{t('dashC.wholesale.bestSeller')}</span>
            </>
          )}
          {!tier.active && (
            <>
              {' · '}
              <span className="font-semibold text-[color:var(--text-muted)]">{t('dashC.wholesale.inactive')}</span>
            </>
          )}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <Money amount={tier.priceIdr} className="text-lg font-bold" />
        <Button variant="secondary" onClick={() => setEditing(true)}>
          {t('dashC.wholesale.edit')}
        </Button>
        <Button variant="ghost" onClick={remove} loading={busy}>
          {t('dashC.wholesale.remove')}
        </Button>
      </div>
    </div>
  );
}

function WholesaleBody() {
  const { t } = useT();
  const { scopedId, selected, depots, ready } = useDepot();
  const [creating, setCreating] = useState(false);

  const list = useAsync<WholesaleTier[]>(
    () => (scopedId ? api.get(endpoints.wholesale.list(scopedId), true) : Promise.resolve([])),
    [scopedId],
  );

  const tiers = useMemo(() => list.data ?? [], [list.data]);
  // Best/bulk = the open-ended tier, else the highest minimum-quantity band.
  const bestId = useMemo(() => {
    if (tiers.length === 0) return null;
    const open = tiers.find((t) => t.maxQty == null);
    if (open) return open.id;
    return tiers.reduce((a, b) => (b.minQty > a.minQty ? b : a)).id;
  }, [tiers]);

  const scopedDepot = selected ?? depots.find((d) => d.id === scopedId) ?? null;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Stack size={24} weight="fill" className="text-brand-500" />
          <div>
            <h1 className="text-2xl font-bold">{t('dashC.wholesale.heading')}</h1>
            <p className="text-sm text-muted">
              {scopedDepot ? `${scopedDepot.name} · ` : ''}{t('dashC.wholesale.subtitle')}
            </p>
          </div>
        </div>
        {!creating && <Button onClick={() => setCreating(true)}>{t('dashC.wholesale.newTitle')}</Button>}
      </div>

      {creating && (
        <TierForm
          depotId={scopedId ?? ''}
          onDone={() => {
            setCreating(false);
            list.reload();
          }}
          onCancel={() => setCreating(false)}
        />
      )}

      {ready && depots.length === 0 ? (
        <CenterState title={t('dashC.wholesale.noDepotTitle')} icon={<Stack size={40} weight="fill" />}>
          {t('dashC.wholesale.noDepotBody')}
        </CenterState>
      ) : list.loading ? (
        <Skeleton className="h-48 w-full" />
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : tiers.length === 0 ? (
        <CenterState title={t('dashC.wholesale.emptyTitle')} icon={<Stack size={40} weight="fill" />}>
          {t('dashC.wholesale.emptyBody')}
        </CenterState>
      ) : (
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">{t('dashC.wholesale.tiersTitle')}</h2>
            <Badge tone="brand">{t('dashC.wholesale.tierCount', { n: tiers.length })}</Badge>
          </div>
          <div className="flex flex-col gap-2.5">
            {tiers.map((t) => (
              <TierRow key={t.id} tier={t} best={t.id === bestId} onChanged={list.reload} />
            ))}
          </div>
        </section>
      )}

      <Card className="flex gap-3 bg-[color:var(--surface-soft)] p-4">
        <Info size={20} weight="fill" className="mt-0.5 shrink-0 text-brand-600" />
        <p className="text-sm text-muted">
          {t('dashC.wholesale.infoPart1')}
          <strong className="text-[color:var(--text)]">{t('dashC.wholesale.infoStrong')}</strong>
          {t('dashC.wholesale.infoPart2')}
        </p>
      </Card>
    </div>
  );
}

function Gate() {
  const { t } = useT();
  const { customer } = useAuth();
  if (!can('depotWholesale', customer?.role)) {
    return (
      <CenterState title={t('dashC.wholesale.gateTitle')} icon={<Lock size={40} weight="fill" />}>
        {t('dashC.wholesale.gateBody')}
      </CenterState>
    );
  }
  return <WholesaleBody />;
}

export default function WholesalePage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
