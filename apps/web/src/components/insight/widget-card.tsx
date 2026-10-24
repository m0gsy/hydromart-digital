'use client';

import Link from 'next/link';
import { useRef, useState, type ReactNode } from 'react';
import { DotsThree } from '@phosphor-icons/react';

import { Card, LoadError, Skeleton } from '@/components/ui';
import { downloadCsv, toCsv } from '@/lib/csv';
import { exportTable } from '@/lib/insight/export';
import type { InsightData } from '@/lib/insight/use-insight-data';
import { useT } from '@/lib/locale-context';
import { todayWib } from '@/lib/wib';

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
  const cardRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showData, setShowData] = useState(false);
  if (source.forbidden) return null;
  const table = source.data != null && !source.error ? exportTable(source.data) : null;
  const canFullscreen = typeof document !== 'undefined' && !!document.fullscreenEnabled;
  const toggleFullscreen = () => {
    setMenuOpen(false);
    if (document.fullscreenElement) void document.exitFullscreen();
    else void cardRef.current?.requestFullscreen?.();
  };
  const exportCsv = () => {
    setMenuOpen(false);
    if (!table) return;
    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    downloadCsv(`${slug || 'data'}-${todayWib()}.csv`, toCsv(table.headers, table.rows));
  };
  const showMenu = !source.error && source.data != null && (table != null || canFullscreen);
  return (
    <Card className={`flex flex-col gap-3 p-4 ${className ?? ''}`}>
      <div ref={cardRef} className="flex flex-col gap-3 bg-[color:var(--surface,transparent)]">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">{title}</h2>
          <div className="relative flex items-center gap-2">
            {detailHref && (
              <Link href={detailHref} className="text-xs font-semibold text-brand-700 underline">
                {t('insight.seeDetail')}
              </Link>
            )}
            {showMenu && (
              <>
                <button
                  type="button"
                  aria-label={t('insight.menu.label')}
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  onClick={() => setMenuOpen((o) => !o)}
                  className="rounded-md p-1 text-muted hover:bg-black/5"
                >
                  <DotsThree size={20} weight="bold" />
                </button>
                {menuOpen && (
                  <div
                    role="menu"
                    className="absolute right-0 top-full z-10 mt-1 flex min-w-40 flex-col rounded-md border border-[color:var(--border,#e9e7df)] bg-[color:var(--surface,#fff)] p-1 text-xs shadow"
                  >
                    {canFullscreen && (
                      <button
                        role="menuitem"
                        type="button"
                        className="p-2 text-left"
                        onClick={toggleFullscreen}
                      >
                        {t('insight.menu.fullscreen')}
                      </button>
                    )}
                    {table && (
                      <>
                        <button
                          role="menuitem"
                          type="button"
                          className="p-2 text-left"
                          onClick={exportCsv}
                        >
                          {t('insight.menu.csv')}
                        </button>
                        <button
                          role="menuitem"
                          type="button"
                          className="p-2 text-left"
                          onClick={() => {
                            setMenuOpen(false);
                            setShowData((v) => !v);
                          }}
                        >
                          {showData ? t('insight.menu.hideData') : t('insight.menu.viewData')}
                        </button>
                      </>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
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
        {showData && table && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[320px] border-collapse text-xs">
              <thead>
                <tr>
                  {table.headers.map((h) => (
                    <th key={h} scope="col" className="p-1 text-left font-medium text-muted">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.slice(0, 50).map((r, i) => (
                  <tr key={i}>
                    {r.map((c, j) => (
                      <td key={j} className="p-1 tabular-nums">
                        {c == null ? '—' : String(c)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Card>
  );
}
