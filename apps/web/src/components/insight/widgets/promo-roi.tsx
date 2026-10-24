'use client';

import type { InsightCtx } from '@/components/insight/context';
import { WidgetCard } from '@/components/insight/widget-card';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { formatDate, formatIDR } from '@/lib/format';
import { useInsightData } from '@/lib/insight/use-insight-data';
import { useT } from '@/lib/locale-context';
import { can } from '@/lib/roles';
import type { PromoRule, PromoRuleUsage } from '@/lib/types';

const TOP = 8;

/**
 * What the promo rules have cost and how often they fired.
 *
 * The server counts a rule's use since it was created, with no window, and says nothing about
 * the revenue those orders brought in: so this shows the discount given and the orders it
 * touched, and labels both "since the start". It is a cost view, not a return.
 */
export function PromoRoiCard({ ctx }: { ctx: InsightCtx }) {
  const { t } = useT();
  const enabled = can('promoRuleRead', ctx.role);
  const usage = useInsightData(
    () => api.get<PromoRuleUsage[]>(endpoints.promoRules.usage, true),
    [],
    enabled,
  );
  const rules = useInsightData(
    () => api.get<PromoRule[]>(endpoints.promoRules.manage, true),
    [],
    enabled,
  );
  if (!enabled) return null;

  const nameOf = new Map((rules.data ?? []).map((r) => [r.id, r.name]));
  const rows = [...(usage.data ?? [])].sort((a, b) => b.totalDiscount - a.totalDiscount);

  return (
    <WidgetCard
      title={t('insight.promoRoi.title')}
      source={usage}
      isEmpty={(d) => d.length === 0}
      emptyText={t('insight.promoRoi.empty')}
      detailHref="/dashboard/promo-rules"
    >
      {() => (
        <div className="flex flex-col gap-2">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] border-collapse text-xs">
              <thead>
                <tr>
                  {['rule', 'orders', 'discount', 'last'].map((c, i) => (
                    <th
                      key={c}
                      scope="col"
                      className={`p-2 font-medium text-muted ${i === 0 ? 'text-left' : 'text-right'}`}
                    >
                      {t(`insight.promoRoi.col.${c}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, TOP).map((r) => (
                  <tr key={r.promoRuleId}>
                    <th scope="row" className="p-2 text-left font-semibold">
                      {nameOf.get(r.promoRuleId) ?? r.promoRuleId.slice(0, 8)}
                    </th>
                    <td className="p-2 text-right tabular-nums">{r.orders}</td>
                    <td className="p-2 text-right tabular-nums">{formatIDR(r.totalDiscount)}</td>
                    <td className="p-2 text-right">
                      {r.lastAppliedAt ? formatDate(r.lastAppliedAt) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-muted">{t('insight.promoRoi.note')}</p>
        </div>
      )}
    </WidgetCard>
  );
}
