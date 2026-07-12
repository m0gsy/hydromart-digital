'use client';

import { useState } from 'react';
import { Lock, Megaphone } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Badge, Button, Card, CenterState, ErrorState, Field, Input, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import { canViewCampaigns } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import type { Promotion, PromotionPayload } from '@/lib/types';

interface PromoForm {
  title: string;
  subtitle: string;
  imageUrl: string;
  ctaLabel: string;
  ctaHref: string;
  voucherCode: string;
  sortOrder: string;
  active: boolean;
  startsAt: string; // yyyy-mm-dd
  endsAt: string;
}

const EMPTY: PromoForm = {
  title: '',
  subtitle: '',
  imageUrl: '',
  ctaLabel: '',
  ctaHref: '',
  voucherCode: '',
  sortOrder: '0',
  active: true,
  startsAt: '',
  endsAt: '',
};

function formFrom(p: Promotion): PromoForm {
  const day = (iso: string | null) => (iso ? iso.slice(0, 10) : '');
  return {
    title: p.title,
    subtitle: p.subtitle ?? '',
    imageUrl: p.imageUrl ?? '',
    ctaLabel: p.ctaLabel ?? '',
    ctaHref: p.ctaHref ?? '',
    voucherCode: p.voucherCode ?? '',
    sortOrder: String(p.sortOrder),
    active: p.active,
    startsAt: day(p.startsAt),
    endsAt: day(p.endsAt),
  };
}

function toPayload(f: PromoForm): PromotionPayload {
  const orNull = (s: string) => (s.trim() ? s.trim() : null);
  const dateOrNull = (s: string) => (s ? new Date(s).toISOString() : null);
  return {
    title: f.title.trim(),
    subtitle: orNull(f.subtitle),
    imageUrl: orNull(f.imageUrl),
    ctaLabel: orNull(f.ctaLabel),
    ctaHref: orNull(f.ctaHref),
    voucherCode: orNull(f.voucherCode),
    sortOrder: Number(f.sortOrder) || 0,
    active: f.active,
    startsAt: dateOrNull(f.startsAt),
    endsAt: dateOrNull(f.endsAt),
  };
}

function PromoEditor({ promo, onDone, onCancel }: { promo: Promotion | null; onDone: () => void; onCancel: () => void }) {
  const [form, setForm] = useState<PromoForm>(promo ? formFrom(promo) : EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof PromoForm) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit() {
    if (!form.title.trim()) {
      setError('Judul wajib diisi.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const payload = toPayload(form);
      if (promo) {
        await api.patch(endpoints.promotions.detail(promo.id), payload, true);
      } else {
        // Create defaults to active; visibility is toggled via edit (backend
        // CreatePromotionDto has no `active` field, so sending it 400s).
        delete payload.active;
        await api.post(endpoints.promotions.create, payload, true);
      }
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal menyimpan promo.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4 p-5">
      <h2 className="text-lg font-bold">{promo ? 'Edit promo' : 'Promo baru'}</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Judul">
          <Input value={form.title} onChange={set('title')} placeholder="Gratis ongkir pertama" />
        </Field>
        <Field label="Subjudul">
          <Input value={form.subtitle} onChange={set('subtitle')} placeholder="Untuk pesanan pertama" />
        </Field>
        <Field label="Gambar (URL)">
          <Input value={form.imageUrl} onChange={set('imageUrl')} placeholder="https://…" />
        </Field>
        <Field label="Kode voucher">
          <Input value={form.voucherCode} onChange={set('voucherCode')} placeholder="ONGKIRGRATIS" />
        </Field>
        <Field label="Label tombol">
          <Input value={form.ctaLabel} onChange={set('ctaLabel')} placeholder="Pesan sekarang" />
        </Field>
        <Field label="Link tombol">
          <Input value={form.ctaHref} onChange={set('ctaHref')} placeholder="/products" />
        </Field>
        <Field label="Urutan">
          <Input type="number" value={form.sortOrder} onChange={set('sortOrder')} />
        </Field>
        {promo && (
          <Field label="Aktif" hint="Nonaktifkan untuk menyembunyikan dari beranda">
            <label className="flex items-center gap-2 py-2 text-sm">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
              />
              Tampilkan promo
            </label>
          </Field>
        )}
        <Field label="Mulai" hint="Kosongkan untuk langsung aktif">
          <Input type="date" value={form.startsAt} onChange={set('startsAt')} />
        </Field>
        <Field label="Berakhir" hint="Kosongkan untuk tanpa batas">
          <Input type="date" value={form.endsAt} onChange={set('endsAt')} />
        </Field>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <Button onClick={submit} loading={busy}>
          {promo ? 'Simpan' : 'Buat promo'}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Batal
        </Button>
      </div>
    </Card>
  );
}

function PromotionsAdmin() {
  const { customer } = useAuth();
  const [editing, setEditing] = useState<Promotion | null | undefined>(undefined); // undefined = closed, null = new
  const { data, error, loading, reload } = useAsync<Promotion[]>(
    () => api.get<Promotion[]>(endpoints.promotions.manage, true),
    [],
  );

  if (customer && !canViewCampaigns(customer.role)) {
    return (
      <CenterState icon={<Lock size={48} weight="thin" />} title="Akses ditolak">
        Halaman promo hanya untuk tim marketing.
      </CenterState>
    );
  }

  async function remove(id: string) {
    await api.del(endpoints.promotions.detail(id), true).catch(() => {});
    reload();
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-2">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Megaphone size={24} weight="fill" className="text-brand-600" /> Promo
        </h1>
        {editing === undefined && <Button onClick={() => setEditing(null)}>Promo baru</Button>}
      </div>

      {editing !== undefined && (
        <PromoEditor
          promo={editing}
          onCancel={() => setEditing(undefined)}
          onDone={() => {
            setEditing(undefined);
            reload();
          }}
        />
      )}

      {loading ? (
        <Skeleton className="h-40 w-full" />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : !data || data.length === 0 ? (
        <CenterState icon={<Megaphone size={48} weight="thin" />} title="Belum ada promo">
          Buat promo pertama untuk ditampilkan di beranda pelanggan.
        </CenterState>
      ) : (
        <div className="flex flex-col divide-y divide-[color:var(--border)]">
          {data.map((p) => (
            <div key={p.id} className="flex items-center gap-3 py-3">
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="flex items-center gap-2 font-semibold">
                  {p.title}
                  <Badge tone={p.active ? 'success' : 'neutral'}>{p.active ? 'Aktif' : 'Nonaktif'}</Badge>
                </span>
                {p.subtitle && <span className="truncate text-sm text-muted">{p.subtitle}</span>}
              </div>
              <Button variant="ghost" onClick={() => setEditing(p)}>
                Edit
              </Button>
              <Button variant="danger" onClick={() => remove(p.id)}>
                Hapus
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function PromotionsPage() {
  return (
    <RequireAuth>
      <PromotionsAdmin />
    </RequireAuth>
  );
}
