'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { ArrowRight, Drop } from '@phosphor-icons/react';

import { BiometricRetry } from '@/components/biometric-retry';
import { BrandMark, Button, Card, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import type { OtpChallenge } from '@/lib/types';

// Fixed brand gradient — never flips under dark (spec 4c), so it's an inline literal.
const PANEL_GRADIENT = 'linear-gradient(150deg,#0b4d57,#0c1518)';

// Left hero panel — brand chrome, hidden on mobile (form-only stack).
// ponytail: hero + stat copy has no dictionary keys yet, so it's id-literal.
function BrandPanel() {
  const { t } = useT();
  return (
    <div
      className="relative hidden flex-col overflow-hidden text-white md:flex"
      style={{ background: PANEL_GRADIENT, padding: '48px 44px' }}
    >
      <Drop
        aria-hidden
        weight="fill"
        size={220}
        className="pointer-events-none absolute -right-10 -top-10"
        style={{ color: 'rgba(255,255,255,.05)' }}
      />
      <Link href="/" className="relative">
        <BrandMark tone="accent" circlePx={38} dropPx={20} textClass="text-[20px]" />
      </Link>

      <div className="relative mt-auto">
        <h2 className="font-extrabold" style={{ fontSize: 34, lineHeight: 1.15 }}>
          Air minum,
          <br />
          {t('auth.login.heroLine2')}
        </h2>
        <p className="mt-4 max-w-[340px]" style={{ fontSize: 14.5, color: 'rgba(255,255,255,.72)' }}>
          {t('auth.login.heroBody')}
        </p>
        <div className="mt-7 flex gap-[22px]">
          <div>
            <div className="font-extrabold" style={{ fontSize: 22, color: '#8fe3ee' }}>
              30 mnt
            </div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,.6)' }}>{t('hrFix.loginPage.avgDelivery')}</div>
          </div>
          <div>
            <div className="font-extrabold" style={{ fontSize: 22, color: '#8fe3ee' }}>
              120+
            </div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,.6)' }}>{t('hrFix.loginPage.partnerDepots')}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function LoginForm() {
  const { t } = useT();
  const router = useRouter();
  // Passed through only when it exists. Defaulting it to '/products' here is what sent
  // every signed-in courier, manager and operator into the customer shop: `/verify` cannot
  // tell "no destination asked for" from "the shop was asked for" once it has been filled
  // in, and only the first of those should fall through to `consoleHome()`.
  const next = useSearchParams().get('next');
  // E8: /register hands the number over when it turns out to already have an account,
  // so the visitor does not retype what they just typed.
  const handedOver = useSearchParams().get('phone') ?? '';
  const [phone, setPhone] = useState(handedOver);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const challenge = await api.post<OtpChallenge>(endpoints.auth.login, { phone });
      const params = new URLSearchParams({ phone, purpose: 'LOGIN' });
      if (next) params.set('next', next);
      // E4: carry the server's own cooldown forward so /verify counts the same seconds
      // the server is enforcing, instead of its own guess.
      if (challenge.resendCooldownSeconds) params.set('cd', String(challenge.resendCooldownSeconds));
      // K1.1: and the code's own lifetime with it. The server has always answered with
      // `expiresInSeconds`; both screens dropped it, so /verify could not say the code
      // was about to die and could not tell a dead one from an unlucky one before a guess.
      if (challenge.expiresInSeconds) params.set('exp', String(challenge.expiresInSeconds));
      // The gateway did not answer in time, so the code is on its way rather than
      // already delivered. /verify says so instead of leaving somebody staring at an
      // empty inbox wondering whether to press resend — which the cooldown would
      // refuse anyway.
      if (challenge.deliveryPending) params.set('pending', '1');
      router.push(`/verify?${params.toString()}`);
    } catch (err) {
      // E8: one door. An unknown number used to stop here on a 404 — which since E6 at
      // least reads "Nomor ini belum terdaftar", but still leaves the visitor to find
      // the register link themselves and type the number a second time. Walk them over
      // with it. (This does not widen anything: the 404 already tells anyone asking
      // whether a number has an account. Closing that oracle is an auth-service change,
      // recorded and deliberately not made here.)
      if (err instanceof ApiError && err.code === 'AUTH_CUSTOMER_NOT_FOUND') {
        const onward = new URLSearchParams({ phone });
        if (next) onward.set('next', next);
        router.push(`/register?${onward.toString()}`);
        return;
      }
      setError(err instanceof ApiError ? err.message : t('auth.login.error'));
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex w-full max-w-[360px] flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-[26px] font-extrabold tracking-tight">{t('auth.login.heading')}</h1>
        <p className="text-[13.5px] text-muted">{t('auth.login.subtitle')}</p>
      </div>

      {/* Only ever rendered when a stored session was left unopened by a dismissed prompt. */}
      <BiometricRetry />

      <div className="flex flex-col gap-1.5">
        <label htmlFor="phone" className="text-[12.5px] font-bold">
          {t('auth.login.phoneLabel')}
        </label>
        <div
          className="flex items-center rounded-[14px] border-2 border-brand-600 bg-[color:var(--surface-elevated)]"
          style={{ height: 52, padding: '0 6px 0 14px' }}
        >
          <span className="flex items-center gap-1 whitespace-nowrap border-r border-app pr-3 text-sm font-bold">
            🇮🇩 +62
          </span>
          <input
            id="phone"
            required
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="81234567890"
            className="h-full w-full min-w-0 bg-transparent pl-3 text-[15px] outline-none placeholder:text-[color:var(--text-muted)]"
          />
        </div>
      </div>

      {error && (
        <p className="text-[13px] font-medium text-[color:var(--danger)]" role="alert">
          {error}
        </p>
      )}

      <Button type="submit" loading={loading} className="h-[52px] w-full rounded-[14px] text-[15px] font-extrabold">
        {t('auth.login.submit')}
        {!loading && <ArrowRight size={17} weight="bold" />}
      </Button>

      <p className="text-center text-[13px] text-muted">
        {t('auth.login.noAccount')}{' '}
        <Link
          href={next ? `/register?next=${encodeURIComponent(next)}` : '/register'}
          className="font-bold text-brand-700 hover:underline"
        >
          {t('auth.login.registerCta')}
        </Link>
      </p>

      <p className="text-center text-[11.5px] leading-relaxed text-muted">{t('auth.register.terms')}</p>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="flex min-h-[70dvh] items-center justify-center px-4 py-10">
      <Card className="grid w-full max-w-[1080px] overflow-hidden rounded-[24px] md:min-h-[600px] md:grid-cols-2">
        <BrandPanel />
        <div className="flex items-center justify-center px-6 py-10 md:px-14 md:py-12">
          <Suspense fallback={<Skeleton className="h-96 w-full max-w-[360px] rounded-[14px]" />}>
            <LoginForm />
          </Suspense>
        </div>
      </Card>
    </div>
  );
}
