'use client';

import { useState } from 'react';
import { ArrowLeft, CheckCircle, Lock, Megaphone } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Badge, Button, Card, CenterState, ErrorState, Field, Input, Money, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { formatIDR } from '@/lib/format';
import { useAuth } from '@/lib/auth-context';
import { useT } from '@/lib/locale-context';
import { canViewCampaigns } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import type { Promotion, PromotionAnalytics as PromotionAnalyticsView, PromotionPayload } from '@/lib/types';

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

function Kpi({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-app bg-[color:var(--surface)] p-4">
      <p className="text-[11px] font-bold uppercase tracking-wide text-[color:var(--text-muted)]">{label}</p>
      <div className="mt-1 text-xl font-extrabold tabular-nums">{children}</div>
    </div>
  );
}

/** 10a — per-promo analytics: usage/savings/order-impact + 7-day usage + terms + top users. */
function PromoAnalytics({ promo, onBack }: { promo: Promotion; onBack: () => void }) {
  const { locale, t } = useT();
  const { data, error, loading, reload } = useAsync<PromotionAnalyticsView>(
    () => api.get<PromotionAnalyticsView>(endpoints.promotions.analytics(promo.id), true),
    [promo.id],
  );

  if (loading) return <Skeleton className="h-72 w-full" />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) {
    return (
      <CenterState title={t('opsFix.promoAnalytics.emptyTitle')}>
        {t('opsFix.promoAnalytics.emptyBody')}
      </CenterState>
    );
  }

  const max = Math.max(...data.dailyUses.map((bucket) => bucket.uses), 1);
  const dayLabel = (day: string) =>
    new Intl.DateTimeFormat(locale === 'id' ? 'id-ID' : 'en-US', {
      weekday: 'short',
      timeZone: 'UTC',
    }).format(new Date(`${day}T00:00:00.000Z`));
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="flex h-9 w-9 items-center justify-center rounded-xl bg-[color:var(--surface-soft)] hover:bg-brand-50"
          aria-label={t('opsFix.promoAnalytics.back')}
        >
          <ArrowLeft size={18} weight="bold" />
        </button>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-xl font-extrabold tracking-tight">{data.voucherCode || data.title}</h1>
            <Badge tone={promo.active ? 'success' : 'neutral'}>{promo.active ? 'Aktif' : 'Nonaktif'}</Badge>
          </div>
          <p className="truncate text-xs text-muted">{promo.subtitle || promo.title}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label={t('opsFix.promoAnalytics.used')}>
          {data.totalUses}
          <span className="mt-1 block text-[11px] font-bold text-emerald-700">{t('opsFix.promoAnalytics.thisWeek', { n: data.usesLast7Days })}</span>
        </Kpi>
        <Kpi label={t('opsFix.promoAnalytics.savingsGiven')}><Money amount={data.totalSavingsIdr} /></Kpi>
        <Kpi label={t('opsFix.promoAnalytics.ordersAffected')}>{data.affectedOrderCount}</Kpi>
        <Kpi label={t('opsFix.promoAnalytics.orderValue')}>
          {data.grossAffectedOrderValueIdr === null ? '—' : <Money amount={data.grossAffectedOrderValueIdr} />}
        </Kpi>
      </div>

      {data.orderValueSource === 'unavailable' && (
        <p className="text-[12.5px] text-muted">{t('opsFix.promoAnalytics.sourceUnavailable')}</p>
      )}

      {data.totalUses === 0 && (
        <Card className="p-0">
          <CenterState title={t('opsFix.promoAnalytics.emptyTitle')}>
            {t('opsFix.promoAnalytics.emptyBody')}
          </CenterState>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <Card className="p-5">
          <p className="mb-4 text-sm font-bold">{t('opsFix.promoAnalytics.usage7d')}</p>
          <div className="flex h-28 items-end justify-between gap-2">
            {data.dailyUses.map((bucket) => (
              <div key={bucket.day} className="flex flex-1 flex-col items-center gap-2">
                <div
                  className={`w-full rounded-md ${bucket.uses === max ? 'bg-brand-500' : 'bg-brand-100'}`}
                  style={{ height: `${Math.round((bucket.uses / max) * 96)}px` }}
                />
                <span className="text-[10px] font-semibold text-muted">{dayLabel(bucket.day)}</span>
              </div>
            ))}
          </div>
        </Card>
        <div className="flex flex-col gap-4">
          <Card className="p-5">
            <p className="mb-3 text-sm font-bold">{t('opsFix.promoAnalytics.terms')}</p>
            <ul className="flex flex-col gap-2 text-xs">
              {promo.subtitle && (
                <li className="flex items-center gap-2"><CheckCircle size={15} weight="fill" className="text-emerald-600" />{promo.subtitle}</li>
              )}
              {promo.endsAt && (
                <li className="flex items-center gap-2">
                  <CheckCircle size={15} weight="fill" className="text-emerald-600" />
                  s.d. {new Date(promo.endsAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}
                </li>
              )}
              {promo.voucherCode && (
                <li className="flex items-center gap-2"><CheckCircle size={15} weight="fill" className="text-emerald-600" />Kode {promo.voucherCode}</li>
              )}
            </ul>
          </Card>
          <Card className="p-5">
            <p className="mb-3 text-sm font-bold">{t('opsFix.promoAnalytics.topUsers')}</p>
            {data.topCustomers.length === 0 ? (
              <p className="text-xs text-muted">{t('opsFix.promoAnalytics.noCustomers')}</p>
            ) : (
              data.topCustomers.map((customer) => (
                <div key={customer.customerId} className="flex items-center justify-between gap-3 py-1 text-xs">
                  <span className="min-w-0 truncate font-medium">{customer.customerId}</span>
                  <span className="shrink-0 text-right font-bold tabular-nums">
                    {t('opsFix.promoAnalytics.customerUses', { n: customer.uses })}
                    <span className="block text-[10px] font-medium text-muted">
                      {t('opsFix.promoAnalytics.customerSavings', { amount: formatIDR(customer.savingsIdr) })}
                    </span>
                  </span>
                </div>
              ))
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function PromotionsAdmin() {
  const { t } = useT();
  const { customer } = useAuth();
  const [editing, setEditing] = useState<Promotion | null | undefined>(undefined); // undefined = closed, null = new
  const [analytics, setAnalytics] = useState<Promotion | null>(null);
  const { data, error, loading, reload } = useAsync<Promotion[]>(
    () => api.get<Promotion[]>(endpoints.promotions.manage, true),
    [],
  );

  if (analytics) return <PromoAnalytics promo={analytics} onBack={() => setAnalytics(null)} />;

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
              <Button variant="ghost" onClick={() => setAnalytics(p)}>
                {t('opsFix.promoAnalytics.open')}
              </Button>
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
