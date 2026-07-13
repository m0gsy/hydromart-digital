'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, HandCoins, Star, User } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Button, CenterState, ErrorState, LinkButton, Skeleton } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import { review as reviewID } from '@/lib/dictionaries/id/review';
import { review as reviewEN } from '@/lib/dictionaries/en/review';
import type { Order, OrderReview } from '@/lib/types';

const ASPECTS = ['speed', 'condition', 'courtesy', 'accuracy'] as const;
const TIPS = [0, 2000, 5000] as const;
const CAN_REVIEW: Order['status'][] = ['DELIVERED', 'COMPLETED'];

function Form({ order }: { order: Order }) {
  const { t, locale } = useT();
  const router = useRouter();
  const { toast } = useToast();
  const copy = locale === 'en' ? reviewEN : reviewID;

  const [rating, setRating] = useState(0);
  const [aspects, setAspects] = useState<string[]>([]);
  const [comment, setComment] = useState('');
  const [tip, setTip] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleAspect(a: string) {
    setAspects((cur) => (cur.includes(a) ? cur.filter((x) => x !== a) : [...cur, a]));
  }

  async function submit() {
    if (rating < 1) {
      setError(copy.needRating);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.post(
        endpoints.orders.review(order.id),
        { rating, aspects, comment: comment.trim() || undefined, tipAmount: tip },
        true,
      );
      toast(copy.submitted, 'success');
      router.replace(`/orders/${order.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : copy.submitError);
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-[430px]">
      <div className="flex items-center gap-3">
        <LinkButton href={`/orders/${order.id}`} variant="secondary" className="!h-[38px] !w-[38px] !rounded-full !p-0">
          <ArrowLeft size={17} weight="bold" />
        </LinkButton>
        <div>
          <div className="text-base font-extrabold">{copy.title}</div>
          <div className="text-[11.5px] text-muted">#{order.orderNumber}</div>
        </div>
      </div>

      {/* rating */}
      <div className="mt-5 text-center">
        <span className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-brand-50">
          <User size={28} weight="fill" className="text-brand-600" />
        </span>
        <div className="mt-2 text-sm font-extrabold">
          {order.driverName ? t('review.headingCourier', { name: order.driverName }) : copy.heading}
        </div>
        <div className="mt-3 flex items-center justify-center gap-2">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" onClick={() => setRating(n)} aria-label={`${n}`}>
              <Star
                size={34}
                weight={n <= rating ? 'fill' : 'regular'}
                className={n <= rating ? 'text-[#d09415]' : 'text-[color:var(--border)]'}
              />
            </button>
          ))}
        </div>
        {rating > 0 && (
          <div className="mt-2 text-[12.5px] font-bold text-muted">
            {t(`review.ratingHint.${rating}`)}
          </div>
        )}
      </div>

      {/* aspects */}
      <div className="mb-2.5 mt-5 text-xs font-extrabold uppercase tracking-wide text-muted">
        {copy.aspectsTitle}
      </div>
      <div className="flex flex-wrap gap-2.5">
        {ASPECTS.map((a) => {
          const on = aspects.includes(a);
          return (
            <button
              key={a}
              type="button"
              onClick={() => toggleAspect(a)}
              aria-pressed={on}
              className={`rounded-full border-[1.5px] px-[15px] py-2 text-[12.5px] font-bold transition-colors ${
                on ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-app surface text-muted'
              }`}
            >
              {t(`review.aspects.${a}`)}
            </button>
          );
        })}
      </div>

      {/* comment */}
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder={copy.commentPlaceholder}
        rows={3}
        className="mt-4 w-full resize-none rounded-[14px] border-[1.5px] border-app surface px-3.5 py-3 text-[13px] leading-relaxed outline-none placeholder:text-muted focus:border-brand-600"
      />

      {/* tip */}
      <div className="mt-3 flex items-center gap-3 rounded-[14px] border border-app surface px-3.5 py-[13px]">
        <HandCoins size={20} weight="fill" className="text-brand-600" />
        <div className="flex-1">
          <div className="text-[12.5px] font-extrabold">{copy.tipTitle}</div>
          <div className="text-[11px] text-muted">
            {order.driverName ? t('review.tipBodyCourier', { name: order.driverName }) : copy.tipBody}
          </div>
        </div>
        <div className="flex gap-1.5">
          {TIPS.map((amt) => (
            <button
              key={amt}
              type="button"
              onClick={() => setTip(amt)}
              aria-pressed={tip === amt}
              className={`rounded-lg px-2.5 py-1.5 text-[11.5px] font-extrabold transition-colors ${
                tip === amt ? 'bg-brand-600 text-on-brand' : 'surface border border-app'
              }`}
            >
              {amt === 0 ? '—' : `${amt / 1000}rb`}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="mt-3 text-sm font-semibold text-[color:var(--danger)]">{error}</p>}

      <Button onClick={submit} loading={saving} className="mt-4 w-full">
        {copy.submit}
      </Button>
    </div>
  );
}

function Guard() {
  const { id } = useParams<{ id: string }>();
  const { t, locale } = useT();
  const copy = locale === 'en' ? reviewEN : reviewID;
  const { data: order, error, loading, reload } = useAsync<Order>(() => api.get(endpoints.orders.get(id), true));
  // Existing review (if any) — 404 resolves to null so the form shows.
  const { data: existing } = useAsync<OrderReview | null>(() =>
    api.get<OrderReview>(endpoints.orders.review(id), true).catch(() => null),
  );

  if (loading) return <Skeleton className="mx-auto h-[520px] max-w-[430px] rounded-3xl" />;
  if (error || !order) return <ErrorState message={error ?? 'not found'} onRetry={reload} />;
  if (existing) {
    return (
      <CenterState icon={<Star size={40} weight="fill" />} title={copy.alreadyReviewed}
        action={<LinkButton href={`/orders/${id}`}>{t('common.back')}</LinkButton>} />
    );
  }
  if (!CAN_REVIEW.includes(order.status)) {
    return (
      <CenterState title={copy.notEligible}
        action={<LinkButton href={`/orders/${id}`}>{t('common.back')}</LinkButton>} />
    );
  }
  return <Form order={order} />;
}

export default function ReviewPage() {
  return (
    <RequireAuth>
      <Guard />
    </RequireAuth>
  );
}
