'use client';

import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';

import { AppBar } from '@/components/app-bar';
import { BottomNav } from '@/components/bottom-nav';
import { Footer } from '@/components/footer';
import { Nav } from '@/components/nav';
import { PageTransition } from '@/components/page-transition';
import { CartProvider } from '@/lib/cart-context';
import { LocationProvider } from '@/lib/location-context';
import { isConsolePath } from '@/lib/roles';
import { screenChrome } from '@/lib/screen-chrome';

// Audit F-9: the tour renders for first-time visitors only, and never again once
// dismissed — there is no reason for it to be in the shell's own chunk.
const OnboardingTour = dynamic(
  () => import('@/components/onboarding-tour').then((m) => m.OnboardingTour),
  { ssr: false },
);

/**
 * Splits the shop chrome from the staff consoles. A console route renders nothing but
 * its own layout — no top nav, no cart, no footer, no mobile tab bar — and, because
 * CartProvider lives on the shop branch only, no `GET /cart` on every console page load.
 * Each console layout supplies its own padding.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (isConsolePath(pathname)) return <main>{children}</main>;

  // Below `sm:` the app bar and the tab bar are the navigation; from `sm:` up it is `Nav`
  // and the footer, exactly as before. Both trees are rendered and one of each pair is
  // hidden in CSS — a breakpoint swap survives static export, where there is no viewport
  // to measure at build time.
  const { kind } = screenChrome(pathname);

  return (
    <CartProvider>
      <LocationProvider>
        <AppBar />
        <Nav />
        <main
          className={
            'mx-auto w-full max-w-[1216px] px-4 sm:px-8 sm:pb-10 ' +
            // A bare screen has no app bar to carry the inset, and `targetSdkVersion = 36`
            // means Android draws the app under the status bar whatever the plugin says.
            // Without this, "Masuk" sits under the clock on any current phone.
            // E0: `var(--safe-area-inset-top, env(...))` rather than bare `env()`. The
            // Capacitor plugin always injects the custom property; `env()` alone reports 0
            // on a WebView older than 140, which is the fleet this ships to — so the fix
            // that exists here was silently doing nothing on the phones that need it.
            (kind === 'bare'
              ? 'pt-[calc(var(--safe-area-inset-top,env(safe-area-inset-top))+1.5rem)] '
              : 'pt-6 ') +
            // A6+E0. Only the tab bar needs clearing, and only root screens show it — but a
            // NON-root screen still ends above the gesture bar, and `pb-10` alone put the
            // last row of every detail screen underneath it. `max()` keeps 2.5rem when the
            // inset is 0 and grows when it is not.
            (kind === 'root'
              ? 'pb-24'
              : 'pb-[max(2.5rem,calc(var(--safe-area-inset-bottom,env(safe-area-inset-bottom))+1rem))]')
          }
        >
          <PageTransition>{children}</PageTransition>
        </main>
        <Footer />
        {kind === 'root' && <BottomNav />}
        <OnboardingTour />
      </LocationProvider>
    </CartProvider>
  );
}
