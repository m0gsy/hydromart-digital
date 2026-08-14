'use client';

import { useEffect } from 'react';
import { useT } from '@/lib/locale-context';

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
  const { t } = useT();
  useEffect(() => {
    // ponytail: console for now; wire to a real error reporter (Sentry) if one is added.
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-[60dvh] max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-xl font-extrabold tracking-tight">{t('hrFix.errorPage.title')}</h1>
      <p className="text-sm text-muted">
        {t('hrFix.errorPage.body2')}
      </p>
      <div className="flex gap-3">
        <Button onClick={reset}>{t('hrFix.errorPage.retry')}</Button>
        <LinkButton href="/products" variant="secondary">
          Ke katalog
        </LinkButton>
      </div>
    </main>
  );
}
