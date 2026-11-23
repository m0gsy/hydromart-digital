'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { RequireAuth } from '@/components/require-auth';
import { Button, Card } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { aiHandoff as copyEN } from '@/lib/dictionaries/en/aiHandoff';
import { aiHandoff as copyID } from '@/lib/dictionaries/id/aiHandoff';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import { isStaff } from '@/lib/roles';

/** A PKCE S256 challenge: 43 characters of base64url, as auth-service checks it. */
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
/** The AI web's own state value, echoed back untouched. */
const STATE = /^[A-Za-z0-9_-]{16,128}$/;

/**
 * AI-3b: the hydromart side of the AI web's sign-in (Plan Eksekusi section 4, decision 4).
 * The AI web sends the browser here with its PKCE challenge, its state and where it wants the
 * code; a signed-in staff member's session asks auth-service for a one-time code, and the
 * browser goes on to the address the SERVER answers with (auth-service refuses any but its
 * configured AI web callback). Nothing to click: the AI web re-runs this when its session ends.
 */
function Handoff() {
  const { locale } = useT();
  const copy = locale === 'en' ? copyEN : copyID;
  const { customer } = useAuth();
  const params = useSearchParams();
  const challenge = params.get('challenge') ?? '';
  const state = params.get('state') ?? '';
  const returnTo = params.get('return') ?? '';
  const complete = CHALLENGE.test(challenge) && STATE.test(state) && returnTo !== '';
  const staff = isStaff(customer?.role);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  const go = useCallback(async () => {
    setError(null);
    try {
      const res = await api.post<{ code: string; returnTo: string }>(
        endpoints.auth.handoffCode,
        { codeChallenge: challenge, codeChallengeMethod: 'S256', returnTo },
        true,
      );
      const next = new URL(res.returnTo);
      next.searchParams.set('code', res.code);
      next.searchParams.set('state', state);
      window.location.replace(next.toString());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : copy.failed);
    }
  }, [challenge, state, returnTo, copy.failed]);

  useEffect(() => {
    // Once per visit: a re-render must not spend a second code.
    if (!complete || !staff || started.current) return;
    started.current = true;
    void go();
  }, [complete, staff, go]);

  let body: React.ReactNode;
  if (!complete) body = <p className="text-sm text-muted">{copy.badLink}</p>;
  else if (!staff) body = <p className="text-sm text-muted">{copy.staffOnly}</p>;
  else if (error) {
    body = (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-[color:var(--danger)]" role="alert">
          {error}
        </p>
        <div>
          <Button onClick={() => void go()}>{copy.retry}</Button>
        </div>
      </div>
    );
  } else body = <p className="text-sm" role="status">{copy.working}</p>;

  return (
    <div className="mx-auto flex max-w-[520px] flex-col gap-4 py-6">
      <h1 className="text-[22px] font-extrabold tracking-[-0.02em]">{copy.title}</h1>
      <Card className="p-5">{body}</Card>
    </div>
  );
}

export default function AiHandoffPage() {
  return (
    <RequireAuth>
      <Suspense fallback={null}>
        <Handoff />
      </Suspense>
    </RequireAuth>
  );
}
