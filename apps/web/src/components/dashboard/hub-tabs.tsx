'use client';

import { usePathname } from 'next/navigation';

import { useAuth } from '@/lib/auth-context';
import { useT } from '@/lib/locale-context';
import { HubTabBar } from '@/components/hub-tab-bar';
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
