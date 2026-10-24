'use client';

import { useState } from 'react';
import { ArrowDown, ArrowUp, Info, Minus } from '@phosphor-icons/react';

import { Card } from '@/components/ui';
import { formatPct, type Delta } from '@/lib/insight/delta';
import { useT } from '@/lib/locale-context';

/** Which direction is good news: orders up is, a cancellation rate up is not. */
export type GoodWhen = 'up' | 'down';

function DeltaLine({
  delta,
  label,
  goodWhen,
}: {
  delta: Delta;
  label: string;
  goodWhen: GoodWhen;
}) {
  const { t } = useT();
  if (delta.kind === 'none') {
    return (
      <p className="text-xs text-muted">
        {t('insight.compare.none')} <span className="opacity-70">({label})</span>
      </p>
    );
  }
  if (delta.kind === 'flat') {
    return (
      <p className="flex items-center gap-1 text-xs text-muted">
        <Minus size={12} weight="bold" aria-hidden="true" />
        {t('insight.compare.flat')} {label}
      </p>
    );
  }
  const good = delta.kind === goodWhen;
  const tone = good ? 'text-[color:var(--success)]' : 'text-[color:var(--danger)]';
  const Arrow = delta.kind === 'up' ? ArrowUp : ArrowDown;
  // The direction is a WORD as well as an arrow and a colour: colour alone is not a reading.
  return (
    <p className={`flex items-center gap-1 text-xs font-semibold ${tone}`}>
      <Arrow size={12} weight="bold" aria-hidden="true" />
      <span className="tabular-nums">
        {t(delta.kind === 'up' ? 'insight.compare.up' : 'insight.compare.down')}{' '}
        {formatPct(delta.pct)}%
      </span>
      <span className="font-normal text-muted">{label}</span>
    </p>
  );
}

/**
 * One headline number with what it means, and how it moved.
 *
 * The definition sits behind the (i): a figure that is not obviously what it looks like
 * (revenue that is gross of refunds, an SLA counted from assignment) is only safe to show
 * with the meaning one tap away. `tone="danger"` is for a number that is itself the alarm.
 */
export function KpiCard({
  label,
  value,
  definition,
  hint,
  deltas,
  goodWhen = 'up',
  tone,
}: {
  label: string;
  value: string;
  definition: string;
  hint?: string;
  deltas?: { prev: Delta; year: Delta };
  goodWhen?: GoodWhen;
  tone?: 'danger';
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  return (
    <Card className="flex flex-col gap-1 p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={`${t('insight.kpi.whatIsThis')}: ${label}`}
          className="rounded-full p-1 text-muted hover:text-[color:var(--text)]"
        >
          <Info size={14} aria-hidden="true" />
        </button>
      </div>
      <p
        className={`text-2xl font-bold tabular-nums ${tone === 'danger' ? 'text-[color:var(--danger)]' : ''}`}
      >
        {value}
      </p>
      {hint && <p className="text-xs text-muted">{hint}</p>}
      {open && (
        <p className="rounded-md bg-[color:var(--surface-muted)] p-2 text-xs">{definition}</p>
      )}
      {deltas && (
        <div className="mt-1 flex flex-col gap-0.5">
          <DeltaLine delta={deltas.prev} label={t('insight.compare.prev')} goodWhen={goodWhen} />
          <DeltaLine delta={deltas.year} label={t('insight.compare.year')} goodWhen={goodWhen} />
        </div>
      )}
    </Card>
  );
}
