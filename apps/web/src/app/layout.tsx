import type { Metadata, Viewport } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';

import './globals.css';
import { AppShell } from '@/components/app-shell';
import { NativeBridge } from '@/components/native-bridge';
import { PushForeground } from '@/components/push-foreground';
import { ToastProvider } from '@/components/toast';
import { AuthProvider } from '@/lib/auth-context';
import { LocaleProvider } from '@/lib/locale-context';
import { SPLASH_NET_SCRIPT } from '@/lib/splash-net';
import { ThemeProvider } from '@/lib/theme-context';

const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  display: 'swap',
  variable: '--font-jakarta',
});

export const metadata: Metadata = {
  title: 'Hydromart — Pesan air minum',
  description: 'Pesan galon isi ulang dan air kemasan dari depot terdekat, diantar ke rumahmu.',
  // A static file rather than the app/manifest.ts convention: that convention is a
  // generated route, and the mobile build has to stay free of routes to export.
  manifest: '/manifest.webmanifest',
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
                {/* Needs the toast, so it cannot live in NativeBridge above. */}
                <PushForeground />
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
