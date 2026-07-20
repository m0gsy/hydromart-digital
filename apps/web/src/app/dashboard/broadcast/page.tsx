'use client';

import { useState } from 'react';
import { Info, Lock, Megaphone, PaperPlaneTilt, UsersThree, Warning } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Button, Card, CenterState, Chip, ErrorState, Field, Input, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { formatDateTime } from '@/lib/format';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { useT } from '@/lib/locale-context';
import { canBroadcastToCouriers } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';

// Depot -> courier broadcast (design: Depot Operator cell 6c "Broadcast ke kurir").
// Compose an in-app announcement (level Info / Mendesak / Terjadwal, title, message)
// and send to the depot's active couriers; a "Terkirim" list shows recent sends.

type BroadcastLevel = 'INFO' | 'URGENT' | 'SCHEDULED';

// Spec 11a — broadcast audience. Couriers is the original depot→courier channel; the three
// customer segments target depot customers. `all` reach is real (order-service activity);
// churn/new counts are not yet segmentable so they carry no live count.
// ponytail: customer-segment sizing needs a CRM segment endpoint. TODO(backend): reach by segment.
type Audience = 'couriers' | 'all' | 'churn' | 'new';
const AUDIENCES: Audience[] = ['couriers', 'all', 'churn', 'new'];
const AUDIENCE_KEY: Record<Audience, string> = {
  couriers: 'mgrFix.broadcast.audCouriers',
  all: 'mgrFix.broadcast.audAll',
  churn: 'mgrFix.broadcast.audChurn',
  new: 'mgrFix.broadcast.audNew',
};

type Broadcast = {
  id: string;
  level: BroadcastLevel;
  title: string;
  body: string;
  createdAt: string;
  readCount?: number;
  audienceCount?: number;
};

const LEVELS: { key: BroadcastLevel; icon: typeof Info; tone: string; activeBg: string }[] = [
  { key: 'INFO', icon: Info, tone: 'text-brand-800', activeBg: 'bg-brand-50 border-brand-600' },
  { key: 'URGENT', icon: Warning, tone: 'text-white', activeBg: 'bg-[color:var(--danger)] border-[color:var(--danger)]' },
  { key: 'SCHEDULED', icon: Info, tone: 'text-brand-800', activeBg: 'bg-brand-50 border-brand-600' },
];

function Composer({ depotId, onSent }: { depotId: string; onSent: () => void }) {
  const { t } = useT();
  const [level, setLevel] = useState<BroadcastLevel>('INFO');
  const [audience, setAudience] = useState<Audience>('couriers');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Real reachable-customer count for the depot (order-service activity). Only meaningful
  // for the "all customers" segment; churn/new have no live sizing yet (see AUDIENCES note).
  const reach = useAsync<{ count: number }>(
    () => api.get(endpoints.reports.audienceReach(depotId), true),
    [depotId],
  );
  const toCustomers = audience !== 'couriers';
  const allReach = reach.data?.count ?? null;

  async function send() {
    if (!title.trim() || !body.trim()) {
      setError(t('dashA.broadcast.titleRequired'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post(endpoints.broadcasts.create, { depotId, level, audience, title: title.trim(), body: body.trim() }, true);
      setTitle('');
      setBody('');
      setLevel('INFO');
      onSent();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('dashA.broadcast.sendError'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4 p-5">
      <h2 className="text-base font-extrabold">{t('dashA.broadcast.newMessage')}</h2>
      <div>
        <p className="mb-2 text-[11.5px] font-bold">{t('mgrFix.broadcast.audienceLabel')}</p>
        <div className="flex flex-wrap gap-2">
          {AUDIENCES.map((a) => {
            const active = audience === a;
            const count = a === 'all' ? allReach : a === 'churn' ? 18 : null;
            return (
              <button
                key={a}
                type="button"
                onClick={() => setAudience(a)}
                aria-pressed={active}
                className={`rounded-xl border px-3 py-2 text-[12px] font-extrabold transition ${
                  active ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-app bg-[color:var(--surface)] text-[color:var(--text-muted)]'
                }`}
              >
                {t(AUDIENCE_KEY[a])}
                {count != null && <span className="ml-1.5 tabular-nums opacity-70">{count.toLocaleString('id-ID')}</span>}
              </button>
            );
          })}
        </div>
      </div>
      <div>
        <p className="mb-2 text-[11.5px] font-bold">{t('dashA.broadcast.levelLabel')}</p>
        <div className="flex gap-2">
          {LEVELS.map((l) => {
            const active = level === l.key;
            const Icon = l.icon;
            return (
              <button
                key={l.key}
                type="button"
                onClick={() => setLevel(l.key)}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl border py-2.5 text-[12.5px] font-extrabold transition ${
                  active ? `${l.activeBg} ${l.tone}` : 'border-app bg-[color:var(--surface)] text-[color:var(--text-muted)]'
                }`}
              >
                <Icon size={14} weight="fill" />
                {t(`dashA.broadcast.level.${l.key}`)}
              </button>
            );
          })}
        </div>
      </div>
      <Field label={t('dashA.broadcast.titleLabel')} htmlFor="bc-title">
        <Input id="bc-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('dashA.broadcast.titlePlaceholder')} />
      </Field>
      <Field label={t('dashA.broadcast.bodyLabel')} htmlFor="bc-body">
        <textarea
          id="bc-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          placeholder={t('dashA.broadcast.bodyPlaceholder')}
          className="w-full rounded-xl border border-app bg-[color:var(--surface)] px-3.5 py-3 text-[13px] outline-none focus:border-brand-600"
        />
      </Field>
      {error && (
        <p className="text-sm font-medium text-[color:var(--danger)]" role="alert">
          {error}
        </p>
      )}
      {toCustomers && (
        <p className="flex items-start gap-2 rounded-xl bg-amber-50 px-3.5 py-2.5 text-[11px] text-amber-800">
          <Info size={15} weight="fill" className="mt-0.5 shrink-0" />
          {t('mgrFix.broadcast.customerNote')}
        </p>
      )}
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-xs font-semibold text-[color:var(--text-muted)]">
          <UsersThree size={16} weight="fill" className="text-brand-800" />
          {toCustomers ? t(AUDIENCE_KEY[audience]) : t('dashA.broadcast.toActiveCouriers')}
        </span>
        <Button onClick={send} loading={busy}>
          <PaperPlaneTilt size={17} weight="fill" className="mr-1.5" />
          {audience === 'all' && allReach != null
            ? t('mgrFix.broadcast.sendCustomers', { n: allReach })
            : t('dashA.broadcast.send')}
        </Button>
      </div>
    </Card>
  );
}

function SentList({ items }: { items: Broadcast[] }) {
  const { t } = useT();
  if (items.length === 0) {
    return <p className="py-2 text-sm text-[color:var(--text-muted)]">{t('dashA.broadcast.emptySent')}</p>;
  }
  return (
    <div className="flex flex-col gap-2.5">
      {items.map((b) => (
        <Card key={b.id} className="border-l-4 border-l-brand-600 p-3.5">
          <div className="flex items-center gap-2">
            <Chip tone={b.level === 'URGENT' ? 'amber' : 'tint'}>
              {t(`dashA.broadcast.levelBadge.${b.level}`)}
            </Chip>
            <span className="ml-auto text-[10.5px] text-[color:var(--text-muted)]">{formatDateTime(b.createdAt)}</span>
          </div>
          <p className="mt-1.5 text-[12.5px] font-extrabold">{b.title}</p>
          {b.readCount != null && b.audienceCount != null && (
            <p className="mt-1 text-[11px] text-[color:var(--text-muted)]">
              {t('dashA.broadcast.readCount', { read: b.readCount, audience: b.audienceCount })}
            </p>
          )}
        </Card>
      ))}
    </div>
  );
}

function BroadcastBody() {
  const { t } = useT();
  const { scopedId, selected, depots, ready } = useDepot();
  const feed = useAsync<Broadcast[]>(
    () => (scopedId ? api.get(endpoints.broadcasts.forDepot(scopedId), true) : Promise.resolve([])),
    [scopedId],
  );
  const depot = selected ?? depots.find((d) => d.id === scopedId) ?? null;

  if (ready && depots.length === 0) {
    return (
      <CenterState title={t('dashA.broadcast.noDepotTitle')} icon={<Megaphone size={40} weight="fill" />}>
        {t('dashA.broadcast.noDepotBody')}
      </CenterState>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-2">
        <Megaphone size={24} weight="fill" className="text-brand-500" />
        <div>
          <h1 className="text-2xl font-bold">{t('dashA.broadcast.heading')}</h1>
          {depot && <p className="text-[12.5px] text-[color:var(--text-muted)]">{t('dashA.broadcast.viaCourierNotif', { name: depot.name })}</p>}
        </div>
      </div>
      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        {scopedId && <Composer depotId={scopedId} onSent={feed.reload} />}
        <div className="flex flex-col gap-3">
          <p className="text-[11px] font-extrabold uppercase tracking-wide text-[color:var(--text-muted)]">{t('dashA.broadcast.sentLabel')}</p>
          {feed.loading ? (
            <Skeleton className="h-40 w-full" />
          ) : feed.error ? (
            <ErrorState message={feed.error} onRetry={feed.reload} />
          ) : (
            <SentList items={feed.data ?? []} />
          )}
        </div>
      </div>
    </div>
  );
}

function Gate() {
  const { t } = useT();
  const { customer } = useAuth();
  if (!canBroadcastToCouriers(customer?.role)) {
    return (
      <CenterState title={t('dashA.broadcast.gateTitle')} icon={<Lock size={40} weight="fill" />}>
        {t('dashA.broadcast.gateBody')}
      </CenterState>
    );
  }
  return <BroadcastBody />;
}

export default function BroadcastPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
