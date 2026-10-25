'use client';

import { Segmented } from '@/components/ui';
import type { Grouping, Preset } from '@/lib/insight/range';
import { useT } from '@/lib/locale-context';

export interface DepotOption {
  id: string;
  name: string;
}

/**
 * The controls every tab shares: the period (with a preset or a custom range), how the series
 * is grouped, and which depot. State lives in the dashboard so a tab change keeps them.
 */
export function DateRangeBar({
  preset,
  onPreset,
  custom,
  onCustom,
  valid,
  grouping,
  groupings,
  onGrouping,
  depots,
  depotId,
  onDepot,
  showPeriod = true,
}: {
  preset: Preset;
  onPreset: (next: Preset) => void;
  custom: { from: string; to: string };
  onCustom: (next: { from: string; to: string }) => void;
  valid: boolean;
  grouping: Grouping;
  groupings: readonly Grouping[];
  onGrouping: (next: Grouping) => void;
  depots: readonly DepotOption[];
  depotId: string;
  onDepot: (next: string) => void;
  /** False on a tab that reads no window: the depot is then the only control. */
  showPeriod?: boolean;
}) {
  const { t } = useT();
  const presets: { value: Preset; label: string }[] = [
    { value: 'today', label: t('insight.range.today') },
    { value: 'week', label: t('insight.range.week') },
    { value: 'month', label: t('insight.range.month') },
    { value: 'custom', label: t('insight.range.custom') },
  ];
  const groupingOptions = groupings.map((g) => ({ value: g, label: t(`insight.grouping.${g}`) }));
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        {showPeriod && (
          <>
            <span className="text-xs font-medium text-muted">{t('insight.range.label')}</span>
            {/* One line per pill: wrapped, "Hari ini" broke in two on a 360px phone. */}
            <div className="max-w-full [&_button]:whitespace-nowrap [&_button]:px-2.5">
              <Segmented value={preset} options={presets} onChange={onPreset} />
            </div>
            {groupingOptions.length > 1 && (
              <>
                <span className="text-xs font-medium text-muted">
                  {t('insight.grouping.label')}
                </span>
                <div className="max-w-full [&_button]:whitespace-nowrap [&_button]:px-2.5">
                  <Segmented value={grouping} options={groupingOptions} onChange={onGrouping} />
                </div>
              </>
            )}
          </>
        )}
        {depots.length > 1 && (
          <label className="flex items-center gap-2 text-xs font-medium text-muted">
            {t('insight.depot.label')}
            <select
              value={depotId}
              onChange={(e) => onDepot(e.target.value)}
              className="min-h-9 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-2 text-sm text-[color:var(--text)]"
            >
              <option value="">{t('insight.depot.all')}</option>
              {depots.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {showPeriod && preset === 'custom' && (
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs font-medium text-muted">
            {t('insight.range.from')}
            <input
              type="date"
              value={custom.from}
              max={custom.to || undefined}
              onChange={(e) => onCustom({ ...custom, from: e.target.value })}
              className="min-h-9 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-2 text-sm text-[color:var(--text)]"
            />
          </label>
          <label className="flex items-center gap-2 text-xs font-medium text-muted">
            {t('insight.range.to')}
            <input
              type="date"
              value={custom.to}
              min={custom.from || undefined}
              onChange={(e) => onCustom({ ...custom, to: e.target.value })}
              className="min-h-9 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-2 text-sm text-[color:var(--text)]"
            />
          </label>
          {!valid && (
            <p role="alert" className="text-xs text-[color:var(--danger)]">
              {t('insight.range.invalid')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
