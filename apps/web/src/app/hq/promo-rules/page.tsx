'use client';

import { useMemo } from 'react';
import { Tag as TagIcon } from '@phosphor-icons/react';

import { HqPageHeader } from '@/components/hq/page-header';
import { PromoRulesAdmin } from '@/components/promo-rules-admin';
import { fetchAllDepots } from '@/lib/all-depots';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';

/**
 * Head office's automatic promos: a rule for any depot, or for the whole network. The console
 * is shared with the depot side (components/promo-rules-admin.tsx); only where a rule may live
 * differs.
 */
export default function HqPromoRulesPage() {
  const { t } = useT();
  const depots = useAsync(() => fetchAllDepots(), []);
  const names = useMemo(() => new Map((depots.data ?? []).map((d) => [d.id, d.name])), [depots.data]);

  return (
    <PromoRulesAdmin
      scope={{ mode: 'network' }}
      depotName={(id) => names.get(id)}
      header={(action) => (
        <HqPageHeader
          icon={TagIcon}
          title={t('hq.promoRules.title')}
          subtitle={t('hq.promoRules.subtitle')}
          action={action}
        />
      )}
    />
  );
}
