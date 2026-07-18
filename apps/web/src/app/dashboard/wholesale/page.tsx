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
import { can } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import type { WholesaleTier } from '@/lib/types';

const inputClass =
  'surface-elevated w-full rounded-lg border border-app px-3.5 py-2.5 text-sm placeholder:text-[color:var(--text-muted)] focus:outline focus:outline-2 focus:outline-brand-600';

/** "1–9 galon" / "50+ galon" from a tier's quantity band. */
function rangeLabel(tier: WholesaleTier): string {
  return tier.maxQty == null ? `${tier.minQty}+ galon` : `${tier.minQty}–${tier.maxQty} galon`;
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
      setError('Isi label, jumlah minimum (≥1), dan harga.');
      return;
    }
    const max = maxQty.trim() ? Number(maxQty) : null;
    if (max != null && (!Number.isFinite(max) || max < min)) {
      setError('Jumlah maksimum harus ≥ jumlah minimum (kosongkan untuk tak terbatas).');
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
      setError(err instanceof ApiError ? err.message : 'Gagal menyimpan tingkat.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4 p-5">
      <h2 className="font-semibold">{tier ? 'Ubah tingkat' : 'Tingkat baru'}</h2>
      <Field label="Label" htmlFor="w-label" hint="mis. Grosir besar">
        <Input id="w-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Grosir besar" />
      </Field>
      <div className="flex flex-wrap gap-3">
        <Field label="Jumlah minimum" htmlFor="w-min">
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
        <Field label="Jumlah maksimum" htmlFor="w-max" hint="Kosongkan untuk tak terbatas (50+)">
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
      <Field label="Harga per galon" htmlFor="w-price">
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
          Batal
        </Button>
        <Button onClick={submit} loading={busy}>
          Simpan
        </Button>
      </div>
    </Card>
  );
}

function TierRow({ tier, best, onChanged }: { tier: WholesaleTier; best: boolean; onChanged: () => void }) {
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
        <p className="font-semibold">{rangeLabel(tier)}</p>
        <p className="text-xs text-muted">
          {tier.label}
          {best && (
            <>
              {' · '}
              <span className="font-semibold text-brand-700">TERLARIS B2B</span>
            </>
          )}
          {!tier.active && (
            <>
              {' · '}
              <span className="font-semibold text-[color:var(--text-muted)]">nonaktif</span>
            </>
          )}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <Money amount={tier.priceIdr} className="text-lg font-bold" />
        <Button variant="secondary" onClick={() => setEditing(true)}>
          Ubah
        </Button>
        <Button variant="ghost" onClick={remove} loading={busy}>
          Hapus
        </Button>
      </div>
    </div>
  );
}

function WholesaleBody() {
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
            <h1 className="text-2xl font-bold">Harga borongan</h1>
            <p className="text-sm text-muted">
              {scopedDepot ? `${scopedDepot.name} · ` : ''}tingkat grosir · pelanggan B2B
            </p>
          </div>
        </div>
        {!creating && <Button onClick={() => setCreating(true)}>Tingkat baru</Button>}
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
        <CenterState title="Belum ada depot" icon={<Stack size={40} weight="fill" />}>
          Belum ada depot yang dikonfigurasi.
        </CenterState>
      ) : list.loading ? (
        <Skeleton className="h-48 w-full" />
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : tiers.length === 0 ? (
        <CenterState title="Belum ada tingkat" icon={<Stack size={40} weight="fill" />}>
          Depot ini belum punya tingkat harga borongan. Tambahkan tingkat pertama.
        </CenterState>
      ) : (
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Tingkat harga</h2>
            <Badge tone="brand">{tiers.length} tingkat</Badge>
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
          Harga borongan menimpa harga eceran untuk pelanggan B2B. Saat aturan harga dinamis juga
          aktif, <strong className="text-[color:var(--text)]">prioritas tertinggi yang menang</strong>{' '}
          — atur prioritas tingkat borongan di atas aturan diskon agar harga grosir tidak tertimpa.
        </p>
      </Card>
    </div>
  );
}

function Gate() {
  const { customer } = useAuth();
  if (!can('depotAdmin', customer?.role)) {
    return (
      <CenterState title="Manajer depot saja" icon={<Lock size={40} weight="fill" />}>
        Harga borongan hanya dapat diatur oleh manajer depot.
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
