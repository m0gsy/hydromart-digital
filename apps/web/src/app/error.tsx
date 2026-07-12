'use client';

import { useEffect } from 'react';

import { Button, LinkButton } from '@/components/ui';

// App Router error boundary: catches render-time throws in any route segment so an
// unexpected error shows a recover-able screen instead of a blank white page.
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // ponytail: console for now; wire to a real error reporter (Sentry) if one is added.
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-xl font-extrabold tracking-tight">Ada yang tidak beres</h1>
      <p className="text-sm text-muted">
        Terjadi kesalahan tak terduga. Coba lagi, atau kembali ke katalog.
      </p>
      <div className="flex gap-3">
        <Button onClick={reset}>Coba lagi</Button>
        <LinkButton href="/products" variant="secondary">
          Ke katalog
        </LinkButton>
      </div>
    </main>
  );
}
