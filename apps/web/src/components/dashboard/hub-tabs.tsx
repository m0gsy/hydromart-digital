'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { useAuth } from '@/lib/auth-context';
import { useT } from '@/lib/locale-context';
import { hubOf } from '@/lib/ops-nav';
import { normalisePath } from '@/lib/screen-chrome';

/**
 * Flow PR-3b: the screens of the hub this page belongs to, as tabs across its top. The rail
 * holds one row per hub; this is how a page reaches its siblings. Shown only on a page that
 * is itself one of the hub's screens, and only when the role may open more than one of them.
 */
export function HubTabs() {
  const { t } = useT();
  const { customer } = useAuth();
  const path = normalisePath(usePathname() ?? '');
  const found = hubOf(path, customer?.role);
  if (!found) return null;
  return (
    <HubTabBar
      label={t(`ops.groups.${found.hub.headKey}`)}
      current={path}
      tabs={found.items.map((i) => ({ href: i.href, label: t(`ops.nav.${i.labelKey}`) }))}
    />
  );
}

/** The tab strip itself, shared by the depot and head-office hubs (PR-3c). Nothing for one tab. */
export function HubTabBar({
  label,
  current,
  tabs,
}: {
  label: string;
  current: string;
  tabs: { href: string; label: string }[];
}) {
  if (tabs.length < 2) return null;
  return (
    <nav aria-label={label} className="-mx-1 mb-4 flex gap-1 overflow-x-auto px-1 pb-1">
      {tabs.map((tab) => {
        const on = tab.href === current;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={on ? 'page' : undefined}
            className={
              'inline-flex min-h-11 shrink-0 items-center rounded-lg px-3 py-2 text-[12.5px] font-semibold transition-colors ' +
              (on
                ? 'bg-brand-50 text-brand-800'
                : 'text-[color:var(--text-muted)] hover:bg-[color:var(--surface-soft)]')
            }
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
