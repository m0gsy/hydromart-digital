'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { Lock, Megaphone } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Badge, Button, Card, CenterState, ErrorState, Field, Input, Skeleton, Toggle } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import { useT } from '@/lib/locale-context';
import { can } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import type { Promotion } from '@/lib/types';

// ponytail: no promo-usage analytics endpoint — omitted. promo-service stores no
// per-voucher redemption telemetry, so the old USAGE_7D / TERMS / TOP_USERS blocks were
// fabricated. Dropped rather than faked; add back when an analytics endpoint lands.

// Date fields are stored as ISO datetimes; <input type="date"> wants YYYY-MM-DD.
const toDateInput = (iso: string | null): string => (iso ? iso.slice(0, 10) : '');

/** Real editable form for one promotion (PATCH promotions.detail). */
function PromoEditor({ promo, onSaved }: { promo: Promotion; onSaved: () => void }) {
  const { t } = useT();
  const [title, setTitle] = useState(promo.title);
  const [subtitle, setSubtitle] = useState(promo.subtitle ?? '');
  const [voucherCode, setVoucherCode] = useState(promo.voucherCode ?? '');
  const [active, setActive] = useState(promo.active);
  const [startsAt, setStartsAt] = useState(toDateInput(promo.startsAt));
  const [endsAt, setEndsAt] = useState(toDateInput(promo.endsAt));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function submit() {
    if (title.trim().length < 3) {
      setError(t('dashC.promotionDetail.titleMin'));
      return;
    }
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await api.patch(
        endpoints.promotions.detail(promo.id),
        {
          title: title.trim(),
          subtitle: subtitle.trim() || null,
          voucherCode: voucherCode.trim() || null,
          active,
          startsAt: startsAt || null,
          endsAt: endsAt || null,
        },
        true,
      );
      setSaved(true);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('dashC.promotionDetail.saveError'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4 p-5">
      <h2 className="font-semibold">{t('dashC.promotionDetail.editTitle')}</h2>
      <Field label={t('dashC.promotionDetail.fTitle')} htmlFor="promo-title">
        <Input id="promo-title" value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label={t('dashC.promotionDetail.subtitle')} htmlFor="promo-subtitle">
        <Input id="promo-subtitle" value={subtitle} onChange={(e) => setSubtitle(e.target.value)} />
      </Field>
      <Field label={t('dashC.promotionDetail.voucherCode')} htmlFor="promo-code" hint={t('dashC.promotionDetail.voucherHint')}>
        <Input id="promo-code" value={voucherCode} onChange={(e) => setVoucherCode(e.target.value)} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('dashC.promotionDetail.start')} htmlFor="promo-start">
          <Input id="promo-start" type="date" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
        </Field>
        <Field label={t('dashC.promotionDetail.end')} htmlFor="promo-end">
          <Input id="promo-end" type="date" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
        </Field>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">{t('dashC.promotionDetail.active')}</span>
        <Toggle on={active} onChange={setActive} label={t('dashC.promotionDetail.toggleLabel')} />
      </div>
      {error && (
        <p className="text-sm font-medium text-red-600" role="alert">
          {error}
        </p>
      )}
      {saved && !error && <p className="text-sm font-medium text-[color:var(--success)]">{t('dashC.promotionDetail.saved')}</p>}
      <div className="flex justify-end">
        <Button onClick={submit} loading={busy}>
          {t('dashC.promotionDetail.save')}
        </Button>
      </div>
    </Card>
  );
}

function PromoDetailBody({ id }: { id: string }) {
  const { t } = useT();
  // REAL — promo-service has no GET-one route, so read the admin list and pick this id.
  const promos = useAsync<Promotion[]>(() => api.get<Promotion[]>(endpoints.promotions.manage, true), []);
  const promo = (promos.data ?? []).find((p) => p.id === id) ?? null;
  const code = promo?.voucherCode ?? promo?.title ?? id.slice(0, 8).toUpperCase();
  const active = promo?.active ?? false;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Megaphone size={24} weight="fill" className="text-brand-500" />
          <div>
            {promos.loading ? (
              <Skeleton className="h-8 w-40" />
            ) : (
              <h1 className="flex items-center gap-2 text-2xl font-bold">
                {code}
                <Badge tone={active ? 'success' : 'neutral'}>{active ? t('dashC.promotionDetail.badgeActive') : t('dashC.promotionDetail.badgeInactive')}</Badge>
              </h1>
            )}
            <p className="text-sm text-muted">{t('dashC.promotionDetail.headerSubtitle')}</p>
          </div>
        </div>
      </div>

      {promos.loading ? (
        <Skeleton className="h-96 w-full" />
      ) : promos.error ? (
        <ErrorState message={promos.error} onRetry={promos.reload} />
      ) : !promo ? (
        <CenterState title={t('dashC.promotionDetail.notFoundTitle')} icon={<Megaphone size={40} weight="fill" />}>
          {t('dashC.promotionDetail.notFoundBody')}
        </CenterState>
      ) : (
        <PromoEditor key={promo.id} promo={promo} onSaved={promos.reload} />
      )}
    </div>
  );
}

function Gate() {
  const { t } = useT();
  const { customer } = useAuth();
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';
  if (!can('voucherWrite', customer?.role)) {
    return (
      <CenterState title={t('dashC.promotionDetail.gateTitle')} icon={<Lock size={40} weight="fill" />}>
        {t('dashC.promotionDetail.gateBody')}
      </CenterState>
    );
  }
  return <PromoDetailBody id={id} />;
}

export default function PromoDetailPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
