'use client';

import { CheckCircle, MapPin, Package, Truck } from '@phosphor-icons/react';

import { Card, CenterState, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { formatDateTime } from '@/lib/format';
import { statusLabel, tone } from '@/lib/order-status';
import { useAsync } from '@/lib/use-async';
import { useQueryParam } from '@/lib/use-query-param';
import { useT } from '@/lib/locale-context';
import { track as trackID } from '@/lib/dictionaries/id/track';
import { track as trackEN } from '@/lib/dictionaries/en/track';
import type { PublicTracking } from '@/lib/types';

/**
 * #34 — "lacak pesanan", the public link. No login, no app shell: a stranger holding this
 * URL (a buyer forwarding it to whoever is waiting for the delivery) sees only what
 * `PublicTrackingResponseDto` sends — order-service's own narrow projection, not this
 * screen's choice. There is nothing here to redact; the fields that would matter (name,
 * phone, street address) simply never arrive.
 *
 * Its own small dictionary (lib/dictionaries/{id,en}/track.ts), loaded directly rather than
 * through the main locale aggregator — the same shape /waralaba already uses for a screen
 * reached with no session.
 */
const TONE_STYLE: Record<ReturnType<typeof tone>, { fg: string; bg: string }> = {
  active: { fg: 'text-brand-700', bg: 'bg-brand-50' },
  done: { fg: 'text-[color:var(--success)]', bg: 'bg-[color:var(--success-bg)]' },
  cancelled: { fg: 'text-[color:var(--danger)]', bg: 'bg-[color:var(--danger-bg)]' },
};

function StatusIcon({ status }: { status: PublicTracking['status'] }) {
  if (status === 'COMPLETED' || status === 'DELIVERED')
    return <CheckCircle size={22} weight="fill" />;
  if (status === 'ON_DELIVERY' || status === 'PICKED_UP') return <Truck size={22} weight="fill" />;
  if (status === 'CANCELLED' || status === 'VOIDED') return <Package size={22} />;
  return <Package size={22} weight="fill" />;
}

export default function PublicTrackPage() {
  const { locale } = useT();
  const copy = locale === 'en' ? trackEN : trackID;
  const token = useQueryParam('token');
  const state = useAsync<PublicTracking>(
    () => (token ? api.get(endpoints.orders.track(token)) : Promise.reject(new Error('no token'))),
    [token],
  );

  if (!token) {
    return (
      <CenterState title={copy.noToken} icon={<MapPin size={40} weight="fill" />}>
        {copy.noTokenBody}
      </CenterState>
    );
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col gap-4 p-4">
      <h1 className="mt-2 text-center text-lg font-extrabold">{copy.title}</h1>

      {state.loading ? (
        <Skeleton className="h-64 w-full" />
      ) : state.error || !state.data ? (
        // Not split by status: useAsync keeps only the message, and the two likely causes
        // here (a stale/mistyped link, order-service unreachable) read the same to someone
        // with no account to sign into and investigate from — "not found" covers both.
        <CenterState title={copy.notFound} icon={<MapPin size={40} weight="fill" />}>
          {copy.notFoundBody}
        </CenterState>
      ) : (
        <TrackBody tracking={state.data} copy={copy} />
      )}
    </div>
  );
}

function TrackBody({ tracking, copy }: { tracking: PublicTracking; copy: typeof trackID }) {
  const t = tone(tracking.status);
  const style = TONE_STYLE[t];

  return (
    <>
      <Card className="flex flex-col items-center gap-2 p-6 text-center">
        <span
          className={`flex h-14 w-14 items-center justify-center rounded-full ${style.bg} ${style.fg}`}
        >
          <StatusIcon status={tracking.status} />
        </span>
        <p className="text-sm font-semibold text-muted">{tracking.orderNumber}</p>
        <p className={`text-xl font-extrabold ${style.fg}`}>{statusLabel(tracking.status)}</p>
        <p className="text-sm text-muted">{tracking.city}</p>
        {tracking.estimatedArrivalAt && t === 'active' && (
          <p className="mt-1 text-sm font-semibold">
            {copy.eta.replace('{time}', formatDateTime(tracking.estimatedArrivalAt))}
          </p>
        )}
        {tracking.driverFirstName && t === 'active' && (
          <p className="text-sm text-muted">
            {copy.deliveredBy.replace('{name}', tracking.driverFirstName)}
          </p>
        )}
      </Card>

      <Card className="flex flex-col gap-3 p-4">
        <h2 className="text-sm font-bold text-muted">{copy.history}</h2>
        <ol className="flex flex-col gap-3">
          {tracking.statusHistory.map((h, i) => (
            <li key={`${h.status}-${h.changedAt}`} className="flex items-start gap-3">
              <span
                className={`mt-1 h-2.5 w-2.5 flex-shrink-0 rounded-full ${
                  i === tracking.statusHistory.length - 1
                    ? 'bg-brand-600'
                    : 'bg-[color:var(--border)]'
                }`}
              />
              <div className="flex flex-col">
                <span className="text-sm font-semibold">{statusLabel(h.status)}</span>
                <span className="text-xs text-muted">{formatDateTime(h.changedAt)}</span>
              </div>
            </li>
          ))}
        </ol>
      </Card>
    </>
  );
}
