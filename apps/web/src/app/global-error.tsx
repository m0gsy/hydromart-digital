'use client';

import { useEffect } from 'react';

import { callPlugin } from '@/lib/capacitor';

// Catches failures in the ROOT layout itself, where the normal error boundary and
// Tailwind/layout chrome may be unavailable — so it renders its own <html>/<body>
// with inline styles. Keep it dependency-free.
export default function GlobalError({
  error: _error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // E1. On native the splash is dismissed by JS and by nothing else
  // (`launchAutoHide: false`), and its only caller lives inside the root layout — the
  // very thing that just failed. Rendering this screen therefore has to hide the splash
  // itself, or the app the user is looking at is a splash with no way out and no message.
  // `callPlugin` is a runtime bridge lookup with no `@capacitor/*` import and it never
  // throws, so this stays as dependency-free as the comment above asks for, and is a
  // no-op on the web.
  useEffect(() => {
    callPlugin('SplashScreen', 'hide', { fadeOutDuration: 200 });
  }, []);

  return (
    <html lang="id">
      <body
        style={{
          fontFamily: 'system-ui, -apple-system, sans-serif',
          display: 'flex',
          // `dvh`, not `vh`: on mobile `100vh` is the viewport with the browser chrome
          // hidden, so the last full-height holdout in the app pushed its own content
          // below the fold on the exact screen a user is already confused on.
          minHeight: '100dvh',
          alignItems: 'center',
          justifyContent: 'center',
          margin: 0,
        }}
      >
        {/* Untranslated on purpose: this boundary catches a failure in the ROOT layout,
            which is where LocaleProvider lives. There is no translator to call — rendering
            when the app around it did not is the whole point. check-i18n.mjs skips this
            file by path for that reason. */}
        <main style={{ textAlign: 'center', padding: '1.5rem', color: '#16282e' }}>
          <h1 style={{ fontSize: '1.25rem', marginBottom: '0.5rem', fontWeight: 800 }}>
            Ada yang tidak beres
          </h1>
          <p style={{ color: '#64757c', marginBottom: '1rem' }}>
            Aplikasi gagal dimuat. Silakan coba lagi.
          </p>
          <button
            onClick={reset}
            style={{
              background: '#0c97ac',
              color: '#fff',
              border: 0,
              borderRadius: 999,
              padding: '0.625rem 1.25rem',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Coba lagi
          </button>
        </main>
      </body>
    </html>
  );
}
