'use client';

import type { InsightTabDef, InsightTabId } from '@/lib/insight/access';
import { useT } from '@/lib/locale-context';

/**
 * The tab bar. It scrolls sideways rather than wrapping, so ten tabs stay one line on a phone;
 * each tab is a real button with `aria-selected`, and the panel it controls carries the id.
 */
export function InsightTabs({
  tabs,
  active,
  onSelect,
}: {
  tabs: readonly InsightTabDef[];
  active: InsightTabId;
  onSelect: (id: InsightTabId) => void;
}) {
  const { t } = useT();
  return (
    <div
      role="tablist"
      aria-label={t('insight.tabsAria')}
      className="-mx-1 flex gap-1 overflow-x-auto border-b border-[color:var(--border)] px-1"
    >
      {tabs.map((tab) => {
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`insight-tab-${tab.id}`}
            aria-selected={selected}
            aria-controls={`insight-panel-${tab.id}`}
            onClick={() => onSelect(tab.id)}
            className={`shrink-0 border-b-2 px-3 py-2.5 text-sm font-semibold transition-colors ${
              selected
                ? 'border-brand-600 text-brand-700'
                : 'border-transparent text-muted hover:text-[color:var(--text)]'
            }`}
          >
            {t(tab.labelKey)}
          </button>
        );
      })}
    </div>
  );
}
