'use client';

import { useEffect } from 'react';

import { sentryOptions } from '@/lib/sentry-options';

/**
 * PR-I, the browser half. A 500 reaches the server alerter; a TypeError in a React tree
 * reaches nobody — the customer sees "Ada yang tidak beres", closes the app, and the only
 * record of it is a support message that says "error". That was a real bug hunt (the
 * global-error crash, `d1da1e87`), and it cost a week of guessing.
 *
 * DSN-gated in the strongest sense available on the client: without
 * NEXT_PUBLIC_SENTRY_DSN the SDK is never even downloaded, because the import is dynamic
 * and lives behind the check. Nothing ships to a third party by default, and the bundle
 * does not carry the SDK on a build that has no DSN.
 *
 * Deliberately NOT the `withSentryConfig` wizard setup: that rewrites next.config, adds a
 * webpack plugin and wants an auth token for source-map upload. This app builds three ways
 * (server, static export for the customer APK, static export for the courier APK) and the
 * two export builds are the ones that break first when a build-time plugin appears. Error
 * capture is the part that was missing; tracing, replay and source maps are not.
 */
export function SentryInit() {
  useEffect(() => {
    const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
    if (!dsn) return;
    let cancelled = false;
    void import('@sentry/nextjs').then((Sentry) => {
      if (cancelled) return;
      Sentry.init(sentryOptions(dsn));
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return null;
}
