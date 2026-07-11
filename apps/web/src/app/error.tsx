'use client';

import { useEffect } from 'react';

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
      <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Something went wrong</h1>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        An unexpected error occurred. You can try again, or head back to the catalog.
      </p>
      <div className="flex gap-3">
        <button
          onClick={reset}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Try again
        </button>
        <a
          href="/products"
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          Go to catalog
        </a>
      </div>
    </main>
  );
}
