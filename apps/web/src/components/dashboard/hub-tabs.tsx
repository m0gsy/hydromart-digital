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
  if (!found || found.items.length < 2) return null;
  return (
    <nav
      aria-label={t(`ops.groups.${found.hub.headKey}`)}
      className="-mx-1 mb-4 flex gap-1 overflow-x-auto px-1 pb-1"
    >
      {found.items.map((item) => {
        const on = item.href === path;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={on ? 'page' : undefined}
            className={
              'inline-flex min-h-11 shrink-0 items-center rounded-lg px-3 py-2 text-[12.5px] font-semibold transition-colors ' +
              (on
                ? 'bg-brand-50 text-brand-800'
                : 'text-[color:var(--text-muted)] hover:bg-[color:var(--surface-soft)]')
            }
          >
            {t(`ops.nav.${item.labelKey}`)}
          </Link>
        );
      })}
    </nav>
  );
}
