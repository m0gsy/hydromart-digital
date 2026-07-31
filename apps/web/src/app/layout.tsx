import type { Metadata, Viewport } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';

import './globals.css';
import { AppShell } from '@/components/app-shell';
import { ToastProvider } from '@/components/toast';
import { AuthProvider } from '@/lib/auth-context';
import { LocaleProvider } from '@/lib/locale-context';
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
};

export const viewport: Viewport = {
  themeColor: '#0c97ac',
  width: 'device-width',
  initialScale: 1,
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
      </head>
      <body className="min-h-[100dvh] overflow-x-hidden">
        <ThemeProvider>
          <LocaleProvider>
            <AuthProvider>
              <ToastProvider>
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
