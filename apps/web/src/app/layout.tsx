import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';

import './globals.css';
import { AppShell } from '@/components/app-shell';
import { LocaleSync } from '@/components/locale-sync';
import { NativeBridge } from '@/components/native-bridge';
import { PushForeground } from '@/components/push-foreground';
import { SentryInit } from '@/components/sentry-init';
import { ToastProvider } from '@/components/toast';
import { AuthProvider } from '@/lib/auth-context';
import { LocaleProvider } from '@/lib/locale-context';
import { SPLASH_NET_SCRIPT } from '@/lib/splash-net';
import { ThemeProvider } from '@/lib/theme-context';

/**
 * Self-hosted, not `next/font/google`.
 *
 * `next/font/google` downloads the font AT BUILD TIME. That put `fonts.gstatic.com` on the
 * critical path of every production build: five times in one session CI died with
 * "Failed to fetch `Plus Jakarta Sans` from Google Fonts", which Next reports as
 * "Failed to compile … webpack errors" — a message that reads like a code defect and once
 * cost half an hour of diagnosis before the real cause was found further up the log.
 *
 * The file is the same one Google was serving: the `latin` subset of the VARIABLE font, so
 * one 27 kB file covers 400–800 instead of five static cuts. `subsets: ['latin']` was
 * already the declared subset, so nothing shipped to a browser changes — the bytes are now
 * fetched at `npm run build`-time from disk instead of over the network.
 *
 * Updating it: re-fetch the CSS with a modern browser User-Agent (Google serves woff2 only
 * to those) and take the `src` of the block whose `unicode-range` starts `U+0000-00FF`.
 */
const jakarta = localFont({
  src: './fonts/PlusJakartaSans-latin.woff2',
  weight: '400 800',
  style: 'normal',
  display: 'swap',
  variable: '--font-jakarta',
});

export const metadata: Metadata = {
  // i18n-ok: static route metadata, resolved on the server before any locale exists —
  // the choice is stored in localStorage. Indonesian is the primary market's default.
  title: 'Hydromart — Pesan air minum',
  // i18n-ok: same reason as the title above.
  description: 'Pesan galon isi ulang dan air kemasan dari depot terdekat, diantar ke rumahmu.',
  // A static file rather than the app/manifest.ts convention: that convention is a
  // generated route, and the mobile build has to stay free of routes to export.
  manifest: '/manifest.webmanifest',
  /*
   * What a shared link looks like.
   *
   * Without `metadataBase` Next cannot turn a relative og:image into the absolute URL the
   * Open Graph spec requires, and without `openGraph` there is nothing to render at all — so
   * every Hydromart link pasted into WhatsApp, the country's default way to share anything,
   * arrived as a bare URL. The icon already exists at a fixed public path; this is the
   * declaration that was missing, not an asset.
   *
   * The origin follows NEXT_PUBLIC_SITE_URL when it is set and falls back to the production
   * host, because a build with no value must still produce absolute URLs — a relative
   * og:image is silently dropped by every scraper rather than reported.
   */
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'https://hydromart-digital.com'),
  openGraph: {
    type: 'website',
    siteName: 'Hydromart',
    // i18n-ok: same reason as the title and description above — resolved on the server,
    // before any locale exists.
    title: 'Hydromart — Pesan air minum',
    description: 'Pesan galon isi ulang dan air kemasan dari depot terdekat, diantar ke rumahmu.',
    images: ['/icon-512.png'],
  },
  twitter: {
    card: 'summary',
    title: 'Hydromart — Pesan air minum',
    description: 'Pesan galon isi ulang dan air kemasan dari depot terdekat, diantar ke rumahmu.',
    images: ['/icon-512.png'],
  },
};

export const viewport: Viewport = {
  themeColor: '#0c97ac',
  width: 'device-width',
  initialScale: 1,
  // Seven places already lay out against `env(safe-area-inset-bottom)`, but without
  // `viewport-fit=cover` the browser resolves every one of those insets to 0 — so the
  // bottom nav has been sitting under the iOS home indicator and, once this is wrapped
  // in a native shell, would sit under the Android gesture bar. This one word is what
  // turns the existing CSS on.
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" className={jakarta.variable}>
      <head>
        {/* No-flash theme bootstrap: stamp data-theme before first paint so a saved
            light/dark choice doesn't flash the OS theme. Mirrors applyAttr() in
            theme-context.tsx; `system`/absent falls through to the CSS media query. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('hydromart.theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t;}catch(e){}`,
          }}
        />
        {/* E1. The splash is dismissed by JS and by nothing else. If React never boots —
            a 404'd chunk, syntax an old WebView rejects — no component can hide it,
            including NativeBridge. This is markup, so it runs anyway. See lib/splash-net. */}
        <script dangerouslySetInnerHTML={{ __html: SPLASH_NET_SCRIPT }} />
      </head>
      <body className="min-h-[100dvh] overflow-x-hidden">
        {/* Outside the providers: its WebView-too-old screen has to render even if
            everything below it is failing, and it needs none of their context. */}
        <NativeBridge />
        <ThemeProvider>
          <LocaleProvider>
            <AuthProvider>
              <ToastProvider>
                {/* K5.3: a device that has never been asked adopts the person's stored
                    language. Inside both providers it needs; app-wide, because the
                    adoption used to live on /account and fired nowhere else. */}
                <LocaleSync />
                {/* Needs the toast, so it cannot live in NativeBridge above. */}
                <PushForeground />
                {/* Error reporting, and nothing at all when NEXT_PUBLIC_SENTRY_DSN is blank
                    — the SDK is not even downloaded in that case. */}
                <SentryInit />
                {/* Shop chrome vs. bare console — the cart/location providers ride the
                    shop branch, so consoles never fetch a cart. */}
                <AppShell>{children}</AppShell>
              </ToastProvider>
            </AuthProvider>
          </LocaleProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
