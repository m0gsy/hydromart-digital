import type { Metadata, Viewport } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';

import './globals.css';
import { Nav } from '@/components/nav';
import { Footer } from '@/components/footer';
import { AuthProvider } from '@/lib/auth-context';
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
        <AuthProvider>
          <LocationProvider>
            <Nav />
            <main className="mx-auto w-full max-w-5xl px-4 py-6">{children}</main>
            <Footer />
          </LocationProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
