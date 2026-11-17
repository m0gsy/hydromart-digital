'use client';

import { Tag as TagIcon } from '@phosphor-icons/react';

import { PromoRulesAdmin } from '@/components/promo-rules-admin';
import { useDepot } from '@/lib/depot-context';
import { useT } from '@/lib/locale-context';

/**
 * The depot console's automatic promos. Same console as head office's
 * (components/promo-rules-admin.tsx); here a new rule belongs to the depot being worked in.
 */
export default function DashboardPromoRulesPage() {
  const { t } = useT();
  // `scopedId`, not `selectedId`: a depot-scoped account whose switcher sits on "Semua depot"
  // has selectedId null while the header already names a concrete depot. A new rule created
  // from null is network-wide, which the API refuses for that account ("hanya boleh mengakses
  // depot yang menjadi tanggung jawabnya") — so the form could not be used at all. This is the
  // depot console: a rule here is always for ONE depot, the one the header shows.
  const { scopedId, depots } = useDepot();

  return (
    <PromoRulesAdmin
      scope={{ mode: 'depot', activeDepotId: scopedId }}
      depotName={(id) => (depots ?? []).find((d) => d.id === id)?.name}
      header={(action) => (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <TagIcon size={24} weight="fill" className="text-brand-500" />
            <div>
              <h1 className="text-2xl font-bold">{t('hq.promoRules.title')}</h1>
              <p className="text-sm text-muted">{t('hq.promoRules.subtitle')}</p>
            </div>
          </div>
          {action}
        </div>
      )}
    />
  );
}
