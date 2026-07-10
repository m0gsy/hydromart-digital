import type { Metadata, Viewport } from 'next';

import './globals.css';
import { Nav } from '@/components/nav';
import { AuthProvider } from '@/lib/auth-context';

export const metadata: Metadata = {
  title: 'Hydromart — Order drinking water',
  description: 'Order refill galons and bottled water from your nearest depot, delivered to you.',
};

export const viewport: Viewport = {
  themeColor: '#1f7ae0',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-[100dvh]">
        <AuthProvider>
          <Nav />
          <main className="mx-auto w-full max-w-5xl px-4 py-6">{children}</main>
        </AuthProvider>
      </body>
    </html>
  );
}
