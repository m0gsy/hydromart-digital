'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import { useT } from '@/lib/locale-context';
import type { Session } from '@/lib/types';

// The button only appears when a Google OAuth client id is configured for this
// deployment; without it, phone/OTP stays the sole path. (Backend endpoint has
// always existed — this wires the missing UI.)
const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? '';
const GSI_SRC = 'https://accounts.google.com/gsi/client';

interface CredentialResponse {
  credential?: string;
}
interface GoogleIdApi {
  initialize(config: { client_id: string; callback: (r: CredentialResponse) => void }): void;
  renderButton(parent: HTMLElement, options: Record<string, unknown>): void;
}
declare global {
  interface Window {
    google?: { accounts: { id: GoogleIdApi } };
  }
}

export function GoogleSignInButton({ next }: { next: string }) {
  const router = useRouter();
  const { signIn } = useAuth();
  const { t } = useT();
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!CLIENT_ID) return;
    let cancelled = false;

    async function handle(response: CredentialResponse) {
      if (!response.credential) return;
      try {
        const session = await api.post<Session>(endpoints.auth.google, {
          idToken: response.credential,
        });
        signIn(session);
        router.replace(next);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Google sign-in failed. Try again.');
      }
    }

    function render() {
      if (cancelled || !window.google || !ref.current) return;
      window.google.accounts.id.initialize({ client_id: CLIENT_ID, callback: handle });
      window.google.accounts.id.renderButton(ref.current, {
        theme: 'outline',
        size: 'large',
        width: 320,
        text: 'continue_with',
      });
    }

    if (window.google) {
      render();
      return;
    }
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GSI_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', render);
      return () => existing.removeEventListener('load', render);
    }
    const script = document.createElement('script');
    script.src = GSI_SRC;
    script.async = true;
    script.defer = true;
    script.onload = render;
    document.head.appendChild(script);
    return () => {
      cancelled = true;
    };
  }, [next, router, signIn]);

  if (!CLIENT_ID) return null;

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex w-full items-center gap-3 text-xs text-muted">
        <span className="h-px flex-1 border-t border-app" />
        or
        <span className="h-px flex-1 border-t border-app" />
      </div>
      <div ref={ref} />
      {/* UU PDP: Google is an account-creation path too — consent by continuing. */}
      <p className="max-w-[320px] text-center text-xs leading-relaxed text-muted">
        {t('auth.register.googleConsentPre')}
        <Link href="/kebijakan-privasi" target="_blank" className="underline hover:text-brand-600">
          {t('auth.register.consentPrivacy')}
        </Link>
        .
      </p>
      {error && (
        <p className="text-sm font-medium text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
