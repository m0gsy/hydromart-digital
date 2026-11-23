'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { useToast } from '@/components/toast';
import { Button, Card, ErrorState, Field, Input, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { authenticator as copyEN } from '@/lib/dictionaries/en/authenticator';
import { authenticator as copyID } from '@/lib/dictionaries/id/authenticator';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import { isStaff } from '@/lib/roles';
import { groupSecret } from '@/lib/totp';
import { useAsync } from '@/lib/use-async';

interface TotpStatus {
  available: boolean;
  required: boolean;
  enrolled: boolean;
  recoveryCodesLeft: number;
  lockedUntil: string | null;
}

interface Enrolment {
  secret: string;
  otpauthUri: string;
  sms?: { expiresInSeconds?: number; deliveryPending?: boolean };
}

/**
 * AI-3a: a staff member sets up the authenticator app that the AI web's sign-in asks for
 * (HD-4). The server holds the rules: an SMS code to the account number proves the phone, the
 * first app code proves the app holds the secret, five wrong codes lock it for 15 minutes, and
 * the recovery codes come back once. Resetting a lost one is SUPER_ADMIN's, on the staff
 * directory.
 */
function Authenticator() {
  const { locale } = useT();
  const copy = locale === 'en' ? copyEN : copyID;
  const { customer } = useAuth();
  const { toast } = useToast();
  const staff = isStaff(customer?.role);
  const status = useAsync<TotpStatus | null>(
    () => (staff ? api.get<TotpStatus>(endpoints.auth.totpStatus, true) : Promise.resolve(null)),
    [staff],
  );
  const [enrolment, setEnrolment] = useState<Enrolment | null>(null);
  const [appCode, setAppCode] = useState('');
  const [smsCode, setSmsCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  // Set the moment the server confirms, so the screen does not fall back to the cached
  // "not set up" status while the refetch is on its way (and offer a set-up that would fail).
  const [enrolledNow, setEnrolledNow] = useState<TotpStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const codesHeading = useRef<HTMLHeadingElement>(null);

  const view = status.data?.enrolled ? status.data : (enrolledNow ?? status.data);
  const lockedUntil =
    view?.lockedUntil && new Date(view.lockedUntil).getTime() > Date.now() ? view.lockedUntil : null;

  // The codes exist nowhere else: leaving the page while they are on screen asks first.
  useEffect(() => {
    if (!codes) return undefined;
    codesHeading.current?.focus();
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [codes]);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      setEnrolment(await api.post<Enrolment>(endpoints.auth.totpEnrolment, {}, true));
      setAppCode('');
      setSmsCode('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : copy.failed);
    } finally {
      setBusy(false);
    }
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!/^\d{6}$/.test(appCode.trim())) return setError(copy.badAppCode);
    if (!/^\d{4,8}$/.test(smsCode.trim())) return setError(copy.badSmsCode);
    setBusy(true);
    setError(null);
    try {
      const done = await api.post<{ recoveryCodes: string[] }>(
        endpoints.auth.totpConfirm,
        { code: appCode.trim(), smsCode: smsCode.trim() },
        true,
      );
      setCodes(done.recoveryCodes);
      setEnrolment(null);
      if (status.data) {
        setEnrolledNow({ ...status.data, enrolled: true, recoveryCodesLeft: done.recoveryCodes.length, lockedUntil: null });
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : copy.failed);
      // A wrong code may have locked it: the status says until when.
      status.reload();
    } finally {
      setBusy(false);
    }
  }

  async function copyCodes() {
    try {
      await navigator.clipboard.writeText((codes ?? []).join('\n'));
      toast(copy.copied, 'success');
    } catch {
      toast(copy.copyError, 'error');
    }
  }

  function finish() {
    setCodes(null);
    status.reload();
  }

  const errorLine = error ? (
    <p id="totp-error" className="text-sm text-[color:var(--danger)]" role="alert">
      {error}
    </p>
  ) : null;
  const lockLine = lockedUntil ? (
    <p className="text-sm text-[color:var(--danger)]">
      {copy.locked.replace('{time}', new Date(lockedUntil).toLocaleString(locale === 'en' ? 'en-US' : 'id-ID'))}
    </p>
  ) : null;

  let body: React.ReactNode;
  if (!staff) {
    body = <p className="text-sm text-muted">{copy.staffOnly}</p>;
  } else if (codes) {
    // Shown once: nothing else on the screen until they say the codes are kept.
    body = (
      <section aria-labelledby="totp-codes" className="flex flex-col gap-3">
        <h2 id="totp-codes" ref={codesHeading} tabIndex={-1} className="text-sm font-bold text-[color:var(--warning)]">
          {copy.codesTitle}
        </h2>
        <p className="text-xs text-muted">{copy.codesBody}</p>
        <ol className="grid grid-cols-2 gap-1.5 font-mono text-sm">
          {codes.map((c) => (
            <li key={c} className="rounded-lg bg-[color:var(--surface-soft)] px-2.5 py-1.5">
              {c}
            </li>
          ))}
        </ol>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={finish}>
            {copy.done}
          </Button>
          <Button onClick={copyCodes} autoFocus>
            {copy.copy}
          </Button>
        </div>
      </section>
    );
  } else if (!view && status.loading) {
    body = <Skeleton className="h-24" />;
  } else if (!view) {
    body = <ErrorState message={copy.loadError} onRetry={status.reload} />;
  } else if (!view.available) {
    body = <p className="text-sm text-muted">{copy.unavailable}</p>;
  } else if (view.enrolled) {
    body = (
      <div className="flex flex-col gap-2 text-sm">
        <p className="font-semibold">{copy.enrolled.replace('{n}', String(view.recoveryCodesLeft))}</p>
        {lockLine}
        <p className="text-xs text-muted">{copy.resetHint}</p>
      </div>
    );
  } else if (enrolment) {
    const invalid = Boolean(error);
    body = (
      <form onSubmit={confirm} className="flex flex-col gap-4" noValidate>
        {lockLine}
        <div className="flex flex-col gap-2 text-sm">
          <p>{copy.step1}</p>
          <a href={enrolment.otpauthUri} className="font-bold text-brand-700 underline underline-offset-2">
            {copy.openInApp}
          </a>
          <p className="text-xs text-muted">{copy.typeSecret}</p>
          <code className="break-all rounded-lg bg-[color:var(--surface-soft)] px-2.5 py-2 font-mono text-sm">
            {groupSecret(enrolment.secret)}
          </code>
        </div>
        <p className="text-sm">{copy.step2}</p>
        <p className="text-xs text-muted">
          {enrolment.sms?.deliveryPending
            ? copy.smsPending
            : copy.smsSent.replace('{m}', String(Math.max(1, Math.round((enrolment.sms?.expiresInSeconds ?? 300) / 60))))}
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={copy.appCode} htmlFor="totp-app">
            <Input
              id="totp-app"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={appCode}
              aria-invalid={invalid || undefined}
              aria-describedby={invalid ? 'totp-error' : undefined}
              onChange={(e) => setAppCode(e.target.value)}
            />
          </Field>
          <Field label={copy.smsCode} htmlFor="totp-sms">
            <Input
              id="totp-sms"
              inputMode="numeric"
              value={smsCode}
              aria-invalid={invalid || undefined}
              aria-describedby={invalid ? 'totp-error' : undefined}
              onChange={(e) => setSmsCode(e.target.value)}
            />
          </Field>
        </div>
        {errorLine}
        <div className="flex flex-wrap justify-end gap-2">
          {/* A new secret and a new SMS: the way out of an expired SMS code or a lock. */}
          <Button type="button" variant="secondary" onClick={start} disabled={busy || Boolean(lockedUntil)}>
            {copy.restart}
          </Button>
          <Button type="submit" loading={busy} disabled={Boolean(lockedUntil)}>
            {copy.confirm}
          </Button>
        </div>
      </form>
    );
  } else {
    body = (
      <div className="flex flex-col gap-3 text-sm">
        <p>{view.required ? copy.required : copy.optional}</p>
        {lockLine}
        {errorLine}
        <div>
          <Button onClick={start} loading={busy} disabled={Boolean(lockedUntil)}>
            {busy ? copy.starting : copy.start}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-[640px] flex-col gap-5">
      <Link href="/account" className="tap-44 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700">
        <ArrowLeft size={16} weight="bold" /> {copy.back}
      </Link>
      <div>
        <h1 className="text-[22px] font-extrabold tracking-[-0.02em]">{copy.title}</h1>
        <p className="mt-2 text-sm text-muted">{copy.intro}</p>
      </div>
      <Card className="p-5">{body}</Card>
    </div>
  );
}

export default function AuthenticatorPage() {
  return (
    <RequireAuth>
      <Authenticator />
    </RequireAuth>
  );
}
