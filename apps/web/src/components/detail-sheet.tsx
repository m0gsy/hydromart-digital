'use client';

import type { ReactNode } from 'react';

import { ErrorState, Skeleton } from '@/components/ui';
import { useAsync } from '@/lib/use-async';

/**
 * One record, read fresh by id, rendered by the caller.
 *
 * Four routes in this repo answered "give me this one row" and had no screen — support
 * tickets, suppliers, a courier's settlement, a staff delivery. Each list already carried
 * the row, which is the reason each was left unwired, and it is a reason that expires the
 * moment anything is written: a list is a snapshot from when the page loaded.
 *
 * The shared part is not the layout, it is the three states. A detail that renders its
 * empty shape while the read is in flight looks like a record with nothing in it, and one
 * that renders nothing when the read fails looks like a record that does not exist. Both
 * are answers, and neither is true. So loading and failure are handled here, once, and the
 * caller only ever writes the case where there IS data.
 */
export function DetailSheet<T>({
  load,
  deps,
  errorMessage,
  children,
}: {
  load: () => Promise<T>;
  /** Re-read when these change — the id, normally. */
  deps: unknown[];
  /** What to say when the read fails. The caller knows what the record is called. */
  errorMessage: string;
  children: (record: T) => ReactNode;
}) {
  const { data, error, loading, reload } = useAsync<T>(load, deps);

  if (loading && !data) return <Skeleton className="h-40 w-full rounded-xl" />;
  // `error ?? errorMessage`: the server's own message when there is one (403 from a
  // depot-scope guard says something a generic string cannot), the caller's when there
  // is not.
  if (error || !data) return <ErrorState message={error ?? errorMessage} onRetry={reload} />;
  return <>{children(data)}</>;
}

/** A label/value row, the shape every one of these details is made of. */
export function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-1.5 text-sm">
      <span className="text-[color:var(--text-muted)]">{label}</span>
      <span className="font-medium">{children}</span>
    </div>
  );
}
