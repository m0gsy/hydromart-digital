'use client';

import { usePathname } from 'next/navigation';

import { HubTabBar } from '@/components/hub-tab-bar';
import { useAuth } from '@/lib/auth-context';
import { hqHubOf } from '@/lib/hq-nav';
import { useT } from '@/lib/locale-context';
import { normalisePath } from '@/lib/screen-chrome';

/** Flow PR-3c: the screens of this page's HQ hub, as tabs across its top. */
export function HqHubTabs() {
  const { t } = useT();
  const { customer } = useAuth();
  const path = normalisePath(usePathname() ?? '');
  const hub = hqHubOf(path, customer?.role);
  if (!hub) return null;
  return (
    <HubTabBar
      label={t(`hq.groups.${hub.headKey}`)}
      current={path}
      tabs={hub.items.map((i) => ({ href: i.href, label: t(`hq.nav.${i.labelKey}`) }))}
    />
  );
}
