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
import { canBroadcastToCouriers } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';

// Depot -> courier broadcast (design: Depot Operator cell 6c "Broadcast ke kurir").
// Compose an in-app announcement (level Info / Mendesak / Terjadwal, title, message)
// and send to the depot's active couriers; a "Terkirim" list shows recent sends.

type BroadcastLevel = 'INFO' | 'URGENT' | 'SCHEDULED';

type Broadcast = {
  id: string;
  level: BroadcastLevel;
  title: string;
  body: string;
  createdAt: string;
  readCount?: number;
  audienceCount?: number;
};

const LEVELS: { key: BroadcastLevel; label: string; icon: typeof Info; tone: string; activeBg: string }[] = [
  { key: 'INFO', label: 'Info', icon: Info, tone: 'text-brand-800', activeBg: 'bg-brand-50 border-brand-600' },
  { key: 'URGENT', label: 'Mendesak', icon: Warning, tone: 'text-white', activeBg: 'bg-[color:var(--danger)] border-[color:var(--danger)]' },
  { key: 'SCHEDULED', label: 'Terjadwal', icon: Info, tone: 'text-brand-800', activeBg: 'bg-brand-50 border-brand-600' },
];

function Composer({ depotId, onSent }: { depotId: string; onSent: () => void }) {
  const [level, setLevel] = useState<BroadcastLevel>('INFO');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    if (!title.trim() || !body.trim()) {
      setError('Isi judul dan pesan dulu.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post(endpoints.broadcasts.create, { depotId, level, title: title.trim(), body: body.trim() }, true);
      setTitle('');
      setBody('');
      setLevel('INFO');
      onSent();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal mengirim broadcast.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4 p-5">
      <h2 className="text-base font-extrabold">Pesan baru</h2>
      <div>
        <p className="mb-2 text-[11.5px] font-bold">Level</p>
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
                {l.label}
              </button>
            );
          })}
        </div>
      </div>
      <Field label="Judul" htmlFor="bc-title">
        <Input id="bc-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Stok galon 19L menipis" />
      </Field>
      <Field label="Pesan" htmlFor="bc-body">
        <textarea
          id="bc-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          placeholder="Tahan dulu order galon sampai ±11.00, prioritaskan botol…"
          className="w-full rounded-xl border border-app bg-[color:var(--surface)] px-3.5 py-3 text-[13px] outline-none focus:border-brand-600"
        />
      </Field>
      {error && (
        <p className="text-sm font-medium text-[color:var(--danger)]" role="alert">
          {error}
        </p>
      )}
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-xs font-semibold text-[color:var(--text-muted)]">
          <UsersThree size={16} weight="fill" className="text-brand-800" />
          Ke kurir aktif depot
        </span>
        <Button onClick={send} loading={busy}>
          <PaperPlaneTilt size={17} weight="fill" className="mr-1.5" />
          Kirim broadcast
        </Button>
      </div>
    </Card>
  );
}

function SentList({ items }: { items: Broadcast[] }) {
  if (items.length === 0) {
    return <p className="py-2 text-sm text-[color:var(--text-muted)]">Belum ada broadcast terkirim.</p>;
  }
  return (
    <div className="flex flex-col gap-2.5">
      {items.map((b) => (
        <Card key={b.id} className="border-l-4 border-l-brand-600 p-3.5">
          <div className="flex items-center gap-2">
            <Chip tone={b.level === 'URGENT' ? 'amber' : 'tint'}>
              {b.level === 'URGENT' ? 'MENDESAK' : b.level === 'SCHEDULED' ? 'TERJADWAL' : 'INFO'}
            </Chip>
            <span className="ml-auto text-[10.5px] text-[color:var(--text-muted)]">{formatDateTime(b.createdAt)}</span>
          </div>
          <p className="mt-1.5 text-[12.5px] font-extrabold">{b.title}</p>
          {b.readCount != null && b.audienceCount != null && (
            <p className="mt-1 text-[11px] text-[color:var(--text-muted)]">
              Terbaca {b.readCount}/{b.audienceCount} kurir
            </p>
          )}
        </Card>
      ))}
    </div>
  );
}

function BroadcastBody() {
  const { scopedId, selected, depots, ready } = useDepot();
  const feed = useAsync<Broadcast[]>(
    () => (scopedId ? api.get(endpoints.broadcasts.forDepot(scopedId), true) : Promise.resolve([])),
    [scopedId],
  );
  const depot = selected ?? depots.find((d) => d.id === scopedId) ?? null;

  if (ready && depots.length === 0) {
    return (
      <CenterState title="No depots" icon={<Megaphone size={40} weight="fill" />}>
        Belum ada depot dikonfigurasi.
      </CenterState>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-2">
        <Megaphone size={24} weight="fill" className="text-brand-500" />
        <div>
          <h1 className="text-2xl font-bold">Broadcast</h1>
          {depot && <p className="text-[12.5px] text-[color:var(--text-muted)]">{depot.name} · lewat notifikasi kurir</p>}
        </div>
      </div>
      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        {scopedId && <Composer depotId={scopedId} onSent={feed.reload} />}
        <div className="flex flex-col gap-3">
          <p className="text-[11px] font-extrabold uppercase tracking-wide text-[color:var(--text-muted)]">Terkirim</p>
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
  const { customer } = useAuth();
  if (!canBroadcastToCouriers(customer?.role)) {
    return (
      <CenterState title="Staff access only" icon={<Lock size={40} weight="fill" />}>
        Broadcast tersedia untuk operator & manajer depot.
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
