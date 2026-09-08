'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ArrowLeft, ChatCircleText, CheckCircle, MapPin, Phone, WarningCircle } from '@phosphor-icons/react';

import { DriverShell } from '@/components/driver/driver-shell';
import { Button, Card, FormError } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import type { Delivery, NoShowStatus } from '@/lib/types';
import { useQueryParam } from '@/lib/use-query-param';

/*
 * CA-4-28 — the Chat button sent `'CHAT'` and delivery-service's `ContactMethod` is
 * `CALL | WHATSAPP`, so class-validator rejected it with a 400 on every single tap. The
 * courier saw an error, the attempt was never recorded, and the gate below — which will
 * not let them declare a no-show until enough attempts exist — counted none of them. The
 * only button that ever worked was Call.
 */
type Method = 'CALL' | 'WHATSAPP';

/** Per-delivery contact log, kept on the phone: the server stores a count, not a list. */
const LOG_KEY = (id: string) => `hydromart_noshow_log_${id}`;

const CLOCK = new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit' });

function mmss(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Audit F-16: the mm:ss clock used to live on the page, so every tick re-rendered the
 * whole screen — contact log, buttons, the lot — to move two digits. The interval lives
 * here now; the page above it only re-renders when the deadline actually passes.
 */
function Remaining({ eligibleAt }: { eligibleAt: string | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const eligibleMs = eligibleAt ? new Date(eligibleAt).getTime() : null;
  return <>{eligibleMs !== null ? mmss((eligibleMs - now) / 1000) : '05:00'}</>;
}

function NoShow() {
  const router = useRouter();
  const { t } = useT();
  const id = useQueryParam('id');
  const [status, setStatus] = useState<NoShowStatus | null>(null);
  // Contact log — the backend returns only an attempt count, not per-attempt detail, so
  // method + time are recorded here as the courier makes each attempt.
  const [log, setLog] = useState<{ method: Method; at: number }[]>([]);
  const [elapsed, setElapsed] = useState(false);
  const [busy, setBusy] = useState(false);
  /** CA-4-36: the customer's own number, read from the delivery. Null = nothing to dial. */
  const [phone, setPhone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /*
   * CA-4-30 — this screen used to start from nothing and learn the state only by POSTing
   * an attempt.
   *
   * So an app that restarted mid-wait — a phone that swapped apps while the courier was
   * knocking, a battery saver, a crash — came back saying "0 percobaan" over a 05:00
   * countdown, for a delivery that already had two attempts and a clock most of the way
   * down. The only way to see the truth again was to record another attempt, which is
   * precisely the thing the gate exists to stop them inventing.
   *
   * The gate itself comes back from the server; the per-attempt list is only on this
   * phone, because the server keeps a count and not a list.
   */
  /*
   * CA-4-36. The two buttons below only ever POSTed an attempt: nothing dialled, nothing
   * opened WhatsApp. So a tap recorded "the courier tried to reach the customer" when no
   * such thing had happened — and the no-show gate, which will not let a courier declare a
   * no-show until enough attempts exist, counted every one of them. That is the gate being
   * satisfied by taps rather than by calls.
   *
   * The number is on the delivery, and this screen never read it. `/driver/deliveries/detail`
   * already does exactly this: a `tel:` link when `recipientPhone` is there, inert-but-visible
   * when it is not.
   */
  useEffect(() => {
    if (!id) return;
    let live = true;
    api
      .get<Delivery>(endpoints.deliveries.driver.get(id), true)
      .then((d) => {
        if (live) setPhone(d.recipientPhone ?? null);
      })
      .catch(() => {
        /* No number means the buttons stay inert; the gate is unaffected either way. */
      });
    api
      .get<NoShowStatus>(endpoints.deliveries.driver.contactAttempts(id), true)
      .then((s) => {
        if (live) setStatus(s);
      })
      .catch(() => {
        /* A failed read leaves the screen as it was: the gate is enforced server-side
           anyway, so the worst case is a courier who has to wait rather than one who
           gets through early. */
      });
    try {
      const raw = localStorage.getItem(LOG_KEY(id));
      if (raw && live) setLog(JSON.parse(raw) as { method: Method; at: number }[]);
    } catch {
      /* Unreadable storage costs the detail list, not the gate. */
    }
    return () => {
      live = false;
    };
  }, [id]);

  const eligibleMs = status?.eligibleAt ? new Date(status.eligibleAt).getTime() : null;

  // One timer that fires ONCE, when the wait is actually over — the old per-second poll
  // existed only to notice this single transition.
  useEffect(() => {
    if (eligibleMs === null) return;
    const delay = eligibleMs - Date.now();
    if (delay <= 0) {
      setElapsed(true);
      return;
    }
    setElapsed(false);
    const timer = setTimeout(() => setElapsed(true), delay);
    return () => clearTimeout(timer);
  }, [eligibleMs]);

  /*
   * CA-4-37 — this said `>= 2` while `noShowMinContactAttempts` is a per-depot setting.
   * A depot that asked for three attempts got a button that unlocked one attempt early
   * and a server that then refused the action the screen had just enabled. The threshold
   * now comes back with the status; until it does, only the server's own verdict counts.
   */
  const minAttempts = status?.minAttempts ?? null;
  const ready =
    Boolean(status?.canMarkNoShow) ||
    (elapsed && minAttempts !== null && (status?.attempts ?? 0) >= minAttempts);

  /**
   * CA-4-36. The attempt is recorded as a SIDE EFFECT of a real contact, not instead of one.
   * `wa.me` wants a bare international number; the 08xx → 62xx step is the one
   * `dashboard/crm/page.tsx` already uses.
   */
  const contactHref = (method: Method): string | null => {
    if (!phone) return null;
    if (method === 'CALL') return `tel:${phone.replace(/\s/g, '')}`;
    let n = phone.replace(/\D/g, '');
    if (n.startsWith('0')) n = `62${n.slice(1)}`;
    return `https://wa.me/${n}`;
  };

  const attempt = async (method: Method) => {
    setBusy(true);
    setError(null);
    try {
      setStatus(await api.post<NoShowStatus>(endpoints.deliveries.driver.contactAttempts(id), { method }, true));
      setLog((prev) => {
        const next = [...prev, { method, at: Date.now() }];
        try {
          localStorage.setItem(LOG_KEY(id), JSON.stringify(next));
        } catch {
          /* The list is a convenience; the count above it comes from the server. */
        }
        return next;
      });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('driver.noShow.logError'));
    } finally {
      setBusy(false);
    }
  };

  const markNoShow = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.patch(endpoints.deliveries.driver.noShow(id), undefined, true);
      router.replace('/driver');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('driver.noShow.markError'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 px-4 py-5">
      <header className="flex items-center gap-3">
        <button type="button" onClick={() => router.back()} className="flex size-11 items-center justify-center rounded-xl border border-[color:var(--border)]">
          <ArrowLeft size={18} />
        </button>
        <div className="text-sm font-extrabold">{t('driver.noShow.title')}</div>
      </header>

      <Card className="flex flex-col items-center gap-2 p-6 text-center">
        <WarningCircle size={40} weight="fill" className="text-amber-500" />
        <div className="text-sm text-[color:var(--text-muted)]">{t('driver.noShow.body')}</div>
        <div className="mt-1 text-3xl font-extrabold tabular-nums">
          <Remaining eligibleAt={status?.eligibleAt ?? null} />
        </div>
        <div className="text-[11px] font-bold uppercase tracking-wide text-amber-700">
          {t('courierFix.noShow.remainingLabel')}
        </div>
        <div className="text-[11px] text-[color:var(--text-muted)]">
          {minAttempts === null
      ? t('driver.noShow.attempts', { n: status?.attempts ?? 0 })
      : t('courierFix.noShow.attemptsOf', {
          n: status?.attempts ?? 0,
          min: minAttempts,
        })}
        </div>
      </Card>

      {log.length > 0 && (
        <Card className="p-0">
          <div className="px-4 pb-1 pt-3 text-[11px] font-extrabold uppercase tracking-wide text-[color:var(--text-muted)]">
            {t('courierFix.noShow.contactHeading')}
          </div>
          {log.map((entry, i) => (
            <div key={i} className={`flex items-center gap-3 px-4 py-3 ${i < log.length - 1 ? 'border-b border-[color:var(--border)]' : ''}`}>
              <span className="flex size-8 items-center justify-center rounded-lg bg-green-100 text-green-700">
                {entry.method === 'CALL' ? <Phone size={16} weight="fill" /> : <ChatCircleText size={16} weight="fill" />}
              </span>
              <div className="flex-1 text-[12.5px] font-bold">
                {entry.method === 'CALL' ? t('courierFix.noShow.methodCall') : t('courierFix.noShow.methodChat')}
                <span className="tabular-nums text-[color:var(--text-muted)]"> · {CLOCK.format(entry.at)}</span>
              </div>
              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-green-700">
                <CheckCircle size={15} weight="fill" />
                {t('courierFix.noShow.outcomeLogged')}
              </span>
            </div>
          ))}
        </Card>
      )}

      <FormError message={error} />

      <div className="flex gap-2.5">
        {(['CALL', 'WHATSAPP'] as const).map((method) => {
          const href = contactHref(method);
          const Icon = method === 'CALL' ? Phone : ChatCircleText;
          const label = t(method === 'CALL' ? 'courierFix.noShow.call' : 'courierFix.noShow.chat');
          const style =
            'flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border-[1.5px] py-2.5 text-sm font-extrabold';
          // No number on this delivery: inert and visibly so, rather than a button that
          // records a contact attempt nobody could have made. Same treatment as the Telepon
          // button on /driver/deliveries/detail.
          return href ? (
            <a
              key={method}
              href={href}
              onClick={() => void attempt(method)}
              className={`${style} border-brand-600 text-brand-700 ${busy ? 'pointer-events-none opacity-50' : ''}`}
            >
              <Icon size={17} weight="fill" />
              {label}
            </a>
          ) : (
            <span
              key={method}
              aria-disabled="true"
              title={t('courierFix.noShow.noPhone')}
              className={`${style} border-[color:var(--border)] text-[color:var(--text-muted)]`}
            >
              <Icon size={17} weight="fill" />
              {label}
            </span>
          );
        })}
      </div>

      <div className="flex items-center gap-2 rounded-2xl bg-brand-50 px-3.5 py-3">
        <MapPin size={17} weight="fill" className="shrink-0 text-brand-700" />
        <span className="text-[11.5px] leading-snug text-brand-800">{t('courierFix.noShow.gpsNote')}</span>
      </div>

      <Button loading={busy} disabled={!ready} className="w-full" onClick={markNoShow}>
        {t('driver.noShow.markNoShow')}
      </Button>

      <p className="text-center text-xs text-[color:var(--text-muted)]">
        {t('courierFix.noShow.customerArrived')}{' '}
        <Link href={`/driver/deliveries/detail?id=${id}`} className="inline-flex min-h-11 items-center font-extrabold text-brand-700">
          {t('courierFix.noShow.continueHandover')}
        </Link>
      </p>
    </div>
  );
}

export default function NoShowPage() {
  return (
    <DriverShell nav={false}>
      <NoShow />
    </DriverShell>
  );
}
