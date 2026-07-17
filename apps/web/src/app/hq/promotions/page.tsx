'use client';

import { useState } from 'react';
import { Image as ImageIcon } from '@phosphor-icons/react';

import { Badge, Button, Card, CenterState, ErrorState, Field, Input, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
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
  startsAt: string;
  endsAt: string;
}

const EMPTY: PromoForm = {
  title: '', subtitle: '', imageUrl: '', ctaLabel: '', ctaHref: '', voucherCode: '',
  sortOrder: '0', active: true, startsAt: '', endsAt: '',
};

function formFrom(p: Promotion): PromoForm {
  const day = (iso: string | null) => (iso ? iso.slice(0, 10) : '');
  return {
    title: p.title, subtitle: p.subtitle ?? '', imageUrl: p.imageUrl ?? '', ctaLabel: p.ctaLabel ?? '',
    ctaHref: p.ctaHref ?? '', voucherCode: p.voucherCode ?? '', sortOrder: String(p.sortOrder),
    active: p.active, startsAt: day(p.startsAt), endsAt: day(p.endsAt),
  };
}

function toPayload(f: PromoForm): PromotionPayload {
  const orNull = (s: string) => (s.trim() ? s.trim() : null);
  const dateOrNull = (s: string) => (s ? new Date(s).toISOString() : null);
  return {
    title: f.title.trim(), subtitle: orNull(f.subtitle), imageUrl: orNull(f.imageUrl),
    ctaLabel: orNull(f.ctaLabel), ctaHref: orNull(f.ctaHref), voucherCode: orNull(f.voucherCode),
    sortOrder: Number(f.sortOrder) || 0, active: f.active,
    startsAt: dateOrNull(f.startsAt), endsAt: dateOrNull(f.endsAt),
  };
}

function PromoEditor({ promo, onDone, onCancel }: { promo: Promotion | null; onDone: () => void; onCancel: () => void }) {
  const { t } = useT();
  const [form, setForm] = useState<PromoForm>(promo ? formFrom(promo) : EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof PromoForm) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit() {
    if (!form.title.trim()) {
      setError(t('hq.promotions.needTitle'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const payload = toPayload(form);
      if (promo) {
        await api.patch(endpoints.promotions.detail(promo.id), payload, true);
      } else {
        delete payload.active;
        await api.post(endpoints.promotions.create, payload, true);
      }
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('hq.promotions.saveError'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4 p-5">
      <h2 className="text-lg font-bold">{promo ? t('hq.promotions.editorEdit') : t('hq.promotions.editorNew')}</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('hq.promotions.fields.title')}>
          <Input value={form.title} onChange={set('title')} />
        </Field>
        <Field label={t('hq.promotions.fields.subtitle')}>
          <Input value={form.subtitle} onChange={set('subtitle')} />
        </Field>
        <Field label={t('hq.promotions.fields.image')}>
          <Input value={form.imageUrl} onChange={set('imageUrl')} placeholder="https://…" />
        </Field>
        <Field label={t('hq.promotions.fields.voucher')}>
          <Input value={form.voucherCode} onChange={set('voucherCode')} />
        </Field>
        <Field label={t('hq.promotions.fields.ctaLabel')}>
          <Input value={form.ctaLabel} onChange={set('ctaLabel')} />
        </Field>
        <Field label={t('hq.promotions.fields.ctaHref')}>
          <Input value={form.ctaHref} onChange={set('ctaHref')} placeholder="/products" />
        </Field>
        <Field label={t('hq.promotions.fields.order')}>
          <Input type="number" value={form.sortOrder} onChange={set('sortOrder')} />
        </Field>
        {promo && (
          <Field label={t('hq.promotions.fields.active')}>
            <label className="flex items-center gap-2 py-2 text-sm">
              <input type="checkbox" checked={form.active} onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))} />
              {t('hq.promotions.fields.active')}
            </label>
          </Field>
        )}
        <Field label={t('hq.promotions.fields.start')} hint={t('hq.promotions.startHint')}>
          <Input type="date" value={form.startsAt} onChange={set('startsAt')} />
        </Field>
        <Field label={t('hq.promotions.fields.end')} hint={t('hq.promotions.endHint')}>
          <Input type="date" value={form.endsAt} onChange={set('endsAt')} />
        </Field>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <Button onClick={submit} loading={busy}>
          {promo ? t('hq.promotions.save') : t('hq.promotions.create')}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          {t('hq.promotions.cancel')}
        </Button>
      </div>
    </Card>
  );
}

// Design 17d — homepage carousel slots. Real: promotions.manage + create/detail.
export default function HqPromotionsPage() {
  const { t } = useT();
  const [editing, setEditing] = useState<Promotion | null | undefined>(undefined);
  const { data, error, loading, reload } = useAsync<Promotion[]>(
    () => api.get<Promotion[]>(endpoints.promotions.manage, true),
    [],
  );

  async function remove(id: string) {
    await api.del(endpoints.promotions.detail(id), true).catch(() => {});
    reload();
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ImageIcon size={24} weight="fill" className="text-brand-500" />
          <div>
            <h1 className="text-2xl font-bold">{t('hq.promotions.title')}</h1>
            <p className="text-sm text-muted">{t('hq.promotions.subtitle')}</p>
          </div>
        </div>
        {editing === undefined && <Button onClick={() => setEditing(null)}>{t('hq.promotions.newBanner')}</Button>}
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
        <CenterState icon={<ImageIcon size={48} weight="thin" />} title={t('hq.promotions.empty')} />
      ) : (
        <Card className="flex flex-col divide-y divide-[color:var(--border)] p-0">
          {data.map((p) => (
            <div key={p.id} className="flex items-center gap-3 px-4 py-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-brand-50 text-xs font-bold text-brand-700">
                {p.sortOrder}
              </span>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="flex items-center gap-2 font-semibold">
                  <span className="truncate">{p.title}</span>
                  <Badge tone={p.active ? 'success' : 'neutral'}>
                    {p.active ? t('hq.promotions.active') : t('hq.promotions.inactive')}
                  </Badge>
                </span>
                {p.subtitle && <span className="truncate text-sm text-muted">{p.subtitle}</span>}
              </div>
              <Button variant="ghost" onClick={() => setEditing(p)}>
                {t('hq.promotions.edit')}
              </Button>
              <Button variant="danger" onClick={() => remove(p.id)}>
                {t('hq.promotions.remove')}
              </Button>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
