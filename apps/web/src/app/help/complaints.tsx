'use client';

import { useState } from 'react';

import { useToast } from '@/components/toast';
import { Button, Field, Input, LinkButton, LoadError, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';

/** One row of the support queue, as the customer's own end of it sees it. */
interface Complaint {
  id: string;
  subject: string;
  status: 'OPEN' | 'ASSIGNED' | 'RESOLVED';
  orderRef: string | null;
  createdAt: string;
  messages: { id: string; authorType: 'CUSTOMER' | 'STAFF'; body: string; createdAt: string }[];
}

/**
 * K1.5 — the complaint path a customer did not have.
 *
 * The support table has existed since design 15a and every verb on it belonged to staff:
 * the HQ console lists, replies, assigns and resolves, and the only way a row ever arrived
 * was an operator typing one at the counter. The nearest thing a customer had was this
 * page — an FAQ accordion, plus a WhatsApp button that appears ONLY when their depot has
 * filled in a contact number. A depot that has not leaves them looking at an accordion.
 *
 * So this sits above that button rather than instead of it, and it does not depend on the
 * depot having filled anything in.
 *
 * Signed-in only, said plainly rather than by a disabled button. An unauthenticated write
 * is a spam surface, and a complaint nobody can reply to is worse than none.
 */
export function Complaints() {
  const { t } = useT();
  const { toast } = useToast();
  const { customer } = useAuth();

  const mine = useAsync<Complaint[]>(
    () => (customer ? api.get(endpoints.admin.support.mine, true) : Promise.resolve([])),
    [customer?.id],
  );

  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState('');
  const [orderRef, setOrderRef] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    if (!subject.trim()) {
      setError(t('help.complaints.subjectRequired'));
      return;
    }
    if (!body.trim()) {
      setError(t('help.complaints.bodyRequired'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post(
        endpoints.admin.support.raise,
        {
          subject: subject.trim(),
          body: body.trim(),
          // Omitted rather than sent empty: `forbidNonWhitelisted` accepts the field, but a
          // blank order reference on the console reads as "about an order" and is not.
          ...(orderRef.trim() ? { orderRef: orderRef.trim() } : {}),
        },
        true,
      );
      toast(t('help.complaints.sent'), 'success');
      setOpen(false);
      setSubject('');
      setOrderRef('');
      setBody('');
      mine.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('help.complaints.sendError'));
    } finally {
      setBusy(false);
    }
  }

  if (!customer) {
    return (
      <section className="mt-[18px] rounded-[16px] border border-app surface p-4">
        <h2 className="text-[13px] font-extrabold">{t('help.complaints.title')}</h2>
        <p className="mt-1 text-[12.5px] text-muted">{t('help.complaints.guest')}</p>
        <div className="mt-3">
          <LinkButton href={`/login?next=${encodeURIComponent('/help')}`} variant="secondary">
            {t('nav.signIn')}
          </LinkButton>
        </div>
      </section>
    );
  }

  return (
    <section className="mt-[18px] rounded-[16px] border border-app surface p-4">
      <h2 className="text-[13px] font-extrabold">{t('help.complaints.title')}</h2>

      {open ? (
        <div className="mt-3 flex flex-col gap-3">
          <Field
            label={t('help.complaints.subject')}
            htmlFor="complaint-subject"
            hint={t('help.complaints.subjectHint')}
          >
            <Input
              id="complaint-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={200}
            />
          </Field>
          <Field
            label={t('help.complaints.orderRef')}
            htmlFor="complaint-order"
            hint={t('help.complaints.orderRefHint')}
          >
            <Input
              id="complaint-order"
              value={orderRef}
              onChange={(e) => setOrderRef(e.target.value)}
              maxLength={64}
            />
          </Field>
          <Field
            label={t('help.complaints.body')}
            htmlFor="complaint-body"
            error={error ?? undefined}
          >
            <textarea
              id="complaint-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={2000}
              rows={4}
              className="w-full rounded-[14px] border-[1.5px] border-app surface px-3.5 py-2.5 text-sm outline-none focus:border-brand-600"
            />
          </Field>
          <div className="flex gap-2">
            <Button type="button" loading={busy} onClick={send}>
              {t('help.complaints.send')}
            </Button>
            <Button type="button" variant="secondary" disabled={busy} onClick={() => setOpen(false)}>
              {t('help.complaints.cancel')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3">
          <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
            {t('help.complaints.cta')}
          </Button>
        </div>
      )}

      {/*
        The second half, and the half that makes the first one worth doing: seeing it again
        with whatever staff replied. A complaint you cannot follow up on is the same silence
        with an extra step in front of it.
      */}
      {mine.loading ? (
        <Skeleton className="mt-3 h-16 w-full rounded-xl" />
      ) : mine.error ? (
        <div className="mt-3">
          <LoadError onRetry={mine.reload} className="rounded-[14px] border border-app px-3.5 py-3" />
        </div>
      ) : (mine.data ?? []).length === 0 ? (
        <p className="mt-3 text-[12.5px] text-muted">{t('help.complaints.empty')}</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {(mine.data ?? []).map((c) => {
            const reply = [...c.messages].reverse().find((m) => m.authorType === 'STAFF');
            return (
              <li key={c.id} className="rounded-[14px] border border-app px-3.5 py-3">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-[12.5px] font-bold">{c.subject}</span>
                  <span className="flex-shrink-0 text-[11px] text-muted">
                    {t(`help.complaints.status.${c.status}`)}
                  </span>
                </div>
                {c.orderRef && <div className="mt-0.5 text-[11.5px] text-muted">{c.orderRef}</div>}
                {reply && (
                  <div className="mt-1.5 text-[12px]">
                    <span className="font-bold text-brand-700">{t('help.complaints.reply')}: </span>
                    <span className="text-muted">{reply.body}</span>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
