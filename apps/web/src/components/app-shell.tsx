'use client';

import { usePathname } from 'next/navigation';

import { BottomNav } from '@/components/bottom-nav';
import { Footer } from '@/components/footer';
import { Nav } from '@/components/nav';
import { OnboardingTour } from '@/components/onboarding-tour';
import { PageTransition } from '@/components/page-transition';
import { CartProvider } from '@/lib/cart-context';
import { LocationProvider } from '@/lib/location-context';
import { isConsolePath } from '@/lib/roles';

/**
 * Splits the shop chrome from the staff consoles. A console route renders nothing but
 * its own layout — no top nav, no cart, no footer, no mobile tab bar — and, because
 * CartProvider lives on the shop branch only, no `GET /cart` on every console page load.
 * Each console layout supplies its own padding.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  if (isConsolePath(usePathname())) return <main>{children}</main>;

  return (
    <CartProvider>
      <LocationProvider>
        <Nav />
        <main className="mx-auto w-full max-w-[1216px] px-4 pt-6 pb-24 sm:px-8 sm:pb-10">
          <PageTransition>{children}</PageTransition>
        </main>
        <Footer />
        <BottomNav />
        <OnboardingTour />
      </LocationProvider>
    </CartProvider>
  );
}
