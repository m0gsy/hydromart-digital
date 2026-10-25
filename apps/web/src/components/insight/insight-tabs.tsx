'use client';

import { useEffect, useRef } from 'react';

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
  const list = useRef<HTMLDivElement>(null);

  // On a phone only three or four of thirteen tabs fit: the one in use must never be off-screen.
  useEffect(() => {
    const el = list.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    el?.scrollIntoView?.({ block: 'nearest', inline: 'center' });
  }, [active]);

  // Arrow keys move between tabs the way a tablist is expected to, and Home/End jump to the ends.
  const onKeyDown = (e: React.KeyboardEvent) => {
    const i = tabs.findIndex((x) => x.id === active);
    const next =
      e.key === 'ArrowRight'
        ? (i + 1) % tabs.length
        : e.key === 'ArrowLeft'
          ? (i - 1 + tabs.length) % tabs.length
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? tabs.length - 1
              : -1;
    const target = tabs[next];
    if (!target) return;
    e.preventDefault();
    onSelect(target.id);
    requestAnimationFrame(() =>
      document.getElementById(`insight-tab-${target.id}`)?.focus({ preventScroll: false }),
    );
  };
  return (
    <div
      ref={list}
      onKeyDown={onKeyDown}
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
            // Roving tabindex: one stop in the strip, the arrow keys do the rest.
            tabIndex={selected ? 0 : -1}
            onClick={() => onSelect(tab.id)}
            className={`min-h-11 shrink-0 border-b-2 px-3 text-sm font-semibold transition-colors ${
              selected
                ? 'border-brand-600 text-brand-800'
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
