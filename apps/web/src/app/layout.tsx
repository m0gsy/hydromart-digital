import type { Metadata, Viewport } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';

import './globals.css';
import { Nav } from '@/components/nav';
import { Footer } from '@/components/footer';
import { BottomNav } from '@/components/bottom-nav';
import { PageTransition } from '@/components/page-transition';
import { AuthProvider } from '@/lib/auth-context';
import { CartProvider } from '@/lib/cart-context';
import { LocaleProvider } from '@/lib/locale-context';
import { LocationProvider } from '@/lib/location-context';

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
      <body className="min-h-[100dvh]">
        <LocaleProvider>
          <AuthProvider>
            <CartProvider>
              <LocationProvider>
                <Nav />
                <main className="mx-auto w-full max-w-6xl px-4 pt-6 pb-24 sm:px-6 sm:pb-10">
                  <PageTransition>{children}</PageTransition>
                </main>
                <Footer />
                <BottomNav />
              </LocationProvider>
            </CartProvider>
          </AuthProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
