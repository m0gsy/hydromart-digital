'use client';

import { useParams, useRouter } from 'next/navigation';
import { ArrowRight, Check, CheckCircle, MapPin, ShieldCheck } from '@phosphor-icons/react';

import { DriverShell } from '@/components/driver/driver-shell';
import { Card, ErrorState, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAsync } from '@/lib/use-async';
import { useT } from '@/lib/locale-context';
import type { Delivery, DeliveryStatus, Page } from '@/lib/types';

const STAMP = new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
const ACTIVE: DeliveryStatus[] = ['ASSIGNED', 'PICKED_UP', 'ON_DELIVERY'];

/** 1h PoD success screen — shown right after a delivery is completed (DELIVERED + proof). */
function Success() {
  const router = useRouter();
  const { t } = useT();
  const id = String(useParams().id);
  const d = useAsync<Delivery>(() => api.get(endpoints.deliveries.driver.get(id), true), [id]);
  const list = useAsync<Page<Delivery>>(() => api.get(endpoints.deliveries.driver.list(), true), []);

  if (d.loading) return <div className="p-5"><Skeleton className="h-96 w-full" /></div>;
  if (d.error || !d.data) return <div className="p-5"><ErrorState message={d.error ?? t('courierFix.podSuccess.title')} onRetry={d.reload} /></div>;

  const delivery = d.data;
  const proof = delivery.proof;
  const next = (list.data?.items ?? []).find((x) => x.id !== id && ACTIVE.includes(x.status));

  return (
    <div className="flex min-h-dvh flex-col px-5 py-6">
      <div className="flex flex-1 flex-col">
        <div className="flex flex-col items-center pt-6 text-center">
          <span className="flex size-[92px] items-center justify-center rounded-full bg-green-100">
            <span className="flex size-16 items-center justify-center rounded-full bg-green-600 shadow-lg shadow-green-600/40">
              <Check size={34} weight="bold" className="text-white" />
            </span>
          </span>
          <h1 className="mt-4 text-xl font-extrabold tracking-tight">{t('courierFix.podSuccess.title')}</h1>
          <div className="mt-1 text-[13px] tabular-nums text-[color:var(--muted)]">{delivery.orderNumber}</div>
        </div>

        <Card className="mt-6 p-0">
          <Row label={t('courierFix.podSuccess.recipient')}>
            <span className="font-bold">{proof?.recipientName ?? '—'}</span>
          </Row>
          <Row label={t('courierFix.podSuccess.time')}>
            <span className="font-bold tabular-nums">
              {STAMP.format(new Date(proof?.capturedAt ?? delivery.deliveredAt ?? Date.now()))}
            </span>
          </Row>
          <Row label={t('courierFix.podSuccess.gps')}>
            {proof ? (
              <a
                href={`https://maps.google.com/?q=${proof.latitude},${proof.longitude}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-bold tabular-nums text-green-700"
              >
                <MapPin size={14} weight="fill" />
                {proof.latitude.toFixed(4)} · {proof.longitude.toFixed(4)}
              </a>
            ) : (
              <span className="text-[color:var(--muted)]">—</span>
            )}
          </Row>
          <Row label={t('courierFix.podSuccess.proof')} last>
            <span className="inline-flex items-center gap-1 font-bold text-green-700">
              <CheckCircle size={15} weight="fill" />
              {t('courierFix.podSuccess.proofDone')}
            </span>
          </Row>
        </Card>

        <p className="mt-3.5 flex items-start gap-1.5 text-[11px] leading-relaxed text-[color:var(--muted)]">
          <ShieldCheck size={15} className="mt-px shrink-0" />
          {t('courierFix.podSuccess.retention')}
        </p>
      </div>

      <div className="space-y-3 pt-6">
        <button
          type="button"
          onClick={() => router.replace(next ? `/driver/deliveries/${next.id}` : '/driver')}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-600 py-3.5 text-sm font-extrabold text-on-brand shadow-lg shadow-brand-600/20"
        >
          {t('courierFix.podSuccess.next')}
          <ArrowRight size={17} weight="bold" />
        </button>
        <button
          type="button"
          onClick={() => router.replace('/driver')}
          className="w-full text-center text-[13px] font-bold text-[color:var(--muted)]"
        >
          {t('courierFix.podSuccess.backToList')}
        </button>
      </div>
    </div>
  );
}

function Row({ label, children, last }: { label: string; children: React.ReactNode; last?: boolean }) {
  return (
    <div className={`flex items-center justify-between px-4 py-3 text-[13px] ${last ? '' : 'border-b border-[color:var(--border)]'}`}>
      <span className="text-[color:var(--muted)]">{label}</span>
      {children}
    </div>
  );
}

export default function DeliverySuccessPage() {
  return (
    <DriverShell nav={false}>
      <Success />
    </DriverShell>
  );
}
