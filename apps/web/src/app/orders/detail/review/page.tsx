'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Star, User } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Button, CenterState, ErrorState, LinkButton, Skeleton } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { formatDateTime } from '@/lib/format';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import { review as reviewID } from '@/lib/dictionaries/id/review';
import { review as reviewEN } from '@/lib/dictionaries/en/review';
import type { Order, OrderReview } from '@/lib/types';
import { useQueryParam } from '@/lib/use-query-param';

const ASPECTS = ['speed', 'condition', 'courtesy', 'accuracy'] as const;
const CAN_REVIEW: Order['status'][] = ['DELIVERED', 'COMPLETED'];

function Form({ order }: { order: Order }) {
  const { t, locale } = useT();
  const router = useRouter();
  const { toast } = useToast();
  const copy = locale === 'en' ? reviewEN : reviewID;

  const [rating, setRating] = useState(0);
  const [aspects, setAspects] = useState<string[]>([]);
  const [comment, setComment] = useState('');
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
        { rating, aspects, comment: comment.trim() || undefined },
        true,
      );
      toast(copy.submitted, 'success');
      router.replace(`/orders/detail?id=${order.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : copy.submitError);
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-[430px]">
      <div className="flex items-center gap-3">
        <LinkButton href={`/orders/detail?id=${order.id}`} variant="secondary" className="!h-11 !w-11 !rounded-full !p-0">
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
            <button key={n} type="button" onClick={() => setRating(n)} aria-label={t('review.starAria', { n })}>
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
              className={`min-h-11 rounded-full border-[1.5px] px-[15px] py-2 text-[12.5px] font-bold transition-colors ${
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

      {/*
        H12. A tip picker stood here, captioned "Beri tip kurir? · Opsional, langsung ke
        kurir". It wrote `tipAmount` to the review row and NOTHING on earth read it back:
        never charged, never confirmed, never shown again, and it never reached the courier
        the caption promised it went straight to. Payment in this product goes direct to
        the depot with no gateway, so no path existed that could have billed it.

        Measured in production 22 Aug 2026: 0 reviews, 0 tips, Rp 0 — nobody was shorted
        yet, and the first person to tip would have been. The offer is withdrawn rather
        than half-built. The column stays (zero rows, so no migration) and the server still
        accepts the field, so nothing already shipped breaks; what goes is the promise.
      */}
      {error && <p className="mt-3 text-sm font-semibold text-[color:var(--danger)]">{error}</p>}

      <Button onClick={submit} loading={saving} className="mt-4 w-full">
        {copy.submit}
      </Button>
    </div>
  );
}

/**
 * H13. The page already FETCHED this review — it needs it to know whether to show the form
 * — and then threw the contents away, printing "Pesanan ini sudah dinilai." and nothing
 * else. The customer could not read back what they had said, on the one screen that had it
 * in hand.
 *
 * Read-only on purpose: the server allows one review per order, so offering an edit here
 * would be a second button that fails. What it offers instead is the way back.
 */
function SubmittedReview({ review, orderId }: { review: OrderReview; orderId: string }) {
  const { t, locale } = useT();
  const copy = locale === 'en' ? reviewEN : reviewID;

  return (
    <div className="mx-auto max-w-[430px]">
      <div className="flex items-center gap-3">
        <LinkButton href={`/orders/detail?id=${orderId}`} variant="secondary" className="!h-11 !w-11 !rounded-full !p-0">
          <ArrowLeft size={17} weight="bold" />
        </LinkButton>
        <div className="text-base font-extrabold">{copy.alreadyReviewed}</div>
      </div>

      <div className="surface mt-4 rounded-[18px] border border-app p-[18px]">
        <div className="flex items-center gap-1.5">
          {[1, 2, 3, 4, 5].map((n) => (
            <Star
              key={n}
              size={22}
              weight={n <= review.rating ? 'fill' : 'regular'}
              data-testid={n <= review.rating ? 'review-star-filled' : 'review-star-empty'}
              className={n <= review.rating ? 'text-[#d09415]' : 'text-[color:var(--border)]'}
            />
          ))}
        </div>

        {review.aspects.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {review.aspects.map((a) => (
              <span
                key={a}
                className="rounded-full border-[1.5px] border-brand-600 bg-brand-50 px-[13px] py-1.5 text-[12.5px] font-bold text-brand-800"
              >
                {t(`review.aspects.${a}`)}
              </span>
            ))}
          </div>
        )}

        {review.comment && (
          <p className="mt-3 text-[13px] leading-relaxed text-muted">{review.comment}</p>
        )}

        <p className="mt-3 text-[11.5px] text-muted">{formatDateTime(review.createdAt)}</p>
      </div>
    </div>
  );
}

function Guard() {
  const id = useQueryParam('id');
  const { t, locale } = useT();
  const copy = locale === 'en' ? reviewEN : reviewID;
  const { data: order, error, loading, reload } = useAsync<Order>(() => api.get(endpoints.orders.get(id), true));
  // Existing review (if any) — 404 resolves to null so the form shows.
  const { data: existing } = useAsync<OrderReview | null>(() =>
    api.get<OrderReview>(endpoints.orders.review(id), true).catch(() => null),
  );

  if (loading) return <Skeleton className="mx-auto h-[520px] max-w-[430px] rounded-3xl" />;
  if (error || !order) return <ErrorState message={error ?? 'not found'} onRetry={reload} />;
  if (existing) return <SubmittedReview review={existing} orderId={id} />;
  if (!CAN_REVIEW.includes(order.status)) {
    return (
      <CenterState title={copy.notEligible}
        action={<LinkButton href={`/orders/detail?id=${id}`}>{t('common.back')}</LinkButton>} />
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
