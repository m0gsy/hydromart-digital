'use client';

import { useState } from 'react';
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
}

/** The secret in groups of four, as authenticator apps print it: easier to type by hand. */
export function groupSecret(secret: string): string {
  return secret.match(/.{1,4}/g)?.join(' ') ?? secret;
}

/**
 * AI-3a: a staff member sets up the authenticator app that the AI web's sign-in asks for
 * (HD-4). The server holds the rules: an SMS code to the account number proves the phone, the
 * first app code proves the app holds the secret, and the recovery codes come back once.
 * Resetting a lost one is SUPER_ADMIN's, on the staff directory.
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    } catch (err) {
      setError(err instanceof ApiError ? err.message : copy.failed);
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

  let body: React.ReactNode;
  if (!staff) {
    body = <p className="text-sm text-muted">{copy.staffOnly}</p>;
  } else if (codes) {
    // Shown once: nothing else on the screen until they say the codes are kept.
    body = (
      <div role="status" className="flex flex-col gap-3">
        <p className="text-sm font-bold text-[color:var(--warning)]">{copy.codesTitle}</p>
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
      </div>
    );
  } else if (status.loading && !status.data) {
    body = <Skeleton className="h-24" />;
  } else if (status.error || !status.data) {
    body = <ErrorState message={copy.loadError} onRetry={status.reload} />;
  } else if (!status.data.available) {
    body = <p className="text-sm text-muted">{copy.unavailable}</p>;
  } else if (status.data.enrolled) {
    const until = status.data.lockedUntil;
    body = (
      <div className="flex flex-col gap-2 text-sm">
        <p className="font-semibold">{copy.enrolled.replace('{n}', String(status.data.recoveryCodesLeft))}</p>
        {until && (
          <p className="text-[color:var(--danger)]">
            {copy.locked.replace('{time}', new Date(until).toLocaleString(locale === 'en' ? 'en-US' : 'id-ID'))}
          </p>
        )}
        <p className="text-xs text-muted">{copy.resetHint}</p>
      </div>
    );
  } else if (enrolment) {
    body = (
      <form onSubmit={confirm} className="flex flex-col gap-4" noValidate>
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
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={copy.appCode} htmlFor="totp-app">
            <Input
              id="totp-app"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={appCode}
              onChange={(e) => setAppCode(e.target.value)}
            />
          </Field>
          <Field label={copy.smsCode} htmlFor="totp-sms">
            <Input id="totp-sms" inputMode="numeric" value={smsCode} onChange={(e) => setSmsCode(e.target.value)} />
          </Field>
        </div>
        {error && (
          <p className="text-sm text-[color:var(--danger)]" role="alert">
            {error}
          </p>
        )}
        <div className="flex justify-end">
          <Button type="submit" loading={busy}>
            {copy.confirm}
          </Button>
        </div>
      </form>
    );
  } else {
    body = (
      <div className="flex flex-col gap-3 text-sm">
        <p>{status.data.required ? copy.required : copy.optional}</p>
        {error && (
          <p className="text-sm text-[color:var(--danger)]" role="alert">
            {error}
          </p>
        )}
        <div>
          <Button onClick={start} loading={busy}>
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
