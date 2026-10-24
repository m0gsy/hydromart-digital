'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';

import { Card, LoadError, Skeleton } from '@/components/ui';
import type { InsightData } from '@/lib/insight/use-insight-data';
import { useT } from '@/lib/locale-context';

/**
 * The frame every dashboard widget shares, so each one answers the same five situations the
 * same way: still loading, failed, refused, empty, or ready.
 *
 * REFUSED renders as nothing at all. A tab is open to a role through ANY of its widgets, so a
 * widget the server then refuses (another capability, or a per-depot override) is "not for
 * you", not "broken" — and a missing card is the honest rendering of that.
 */
export function WidgetCard<T>({
  title,
  source,
  isEmpty,
  emptyText,
  detailHref,
  className,
  children,
}: {
  title: string;
  source: InsightData<T>;
  /** Whether a loaded answer has nothing to show (a window with no orders). */
  isEmpty?: (data: T) => boolean;
  /** What an empty answer says, when "no data in this period" is not the right sentence. */
  emptyText?: string;
  /** The existing screen this summarises: the dashboard links to it rather than rebuilding it. */
  detailHref?: string;
  className?: string;
  children: (data: T) => ReactNode;
}) {
  const { t } = useT();
  if (source.forbidden) return null;
  return (
    <Card className={`flex flex-col gap-3 p-4 ${className ?? ''}`}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {detailHref && (
          <Link href={detailHref} className="text-xs font-semibold text-brand-700 underline">
            {t('insight.seeDetail')}
          </Link>
        )}
      </div>
      {source.loading && !source.data ? (
        <Skeleton className="h-32 w-full" />
      ) : source.error ? (
        <LoadError onRetry={source.reload} />
      ) : source.data == null || (isEmpty?.(source.data) ?? false) ? (
        <p className="text-xs text-muted">{emptyText ?? t('insight.state.empty')}</p>
      ) : (
        children(source.data)
      )}
    </Card>
  );
}
