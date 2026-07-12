'use client';

import { Storefront, Clock, ShieldCheck, Wallet } from '@phosphor-icons/react';

import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAsync } from '@/lib/use-async';
import { useLocation } from '@/lib/location-context';
import { useT } from '@/lib/locale-context';
import { Card, Chip, Money, Skeleton } from '@/components/ui';
import { LocationSelector } from '@/components/location-selector';
import type { NearbyDepot } from '@/lib/types';

// "Depots near me" — depends on the user's chosen location. When no location is
// set yet, it invites the user to pick one (rather than hiding) so guests learn
// the delivery-coverage answer. With a location, it lists nearest depots.

export function NearbyDepots() {
  const { location, ready } = useLocation();
  const { t } = useT();

  const { data, loading } = useAsync<NearbyDepot[]>(
    () =>
      location
        ? api.get<NearbyDepot[]>(endpoints.depots.nearby({ lat: location.lat, lng: location.lng, limit: 4 }))
        : Promise.resolve([] as NearbyDepot[]),
    [location?.lat, location?.lng],
  );

  if (!ready) return null;

  return (
    <section aria-label={t('home.depots.aria')}>
      <Card className="flex flex-col gap-3 p-6">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-extrabold">{t('home.depots.title')}</h2>
          {location && <LocationSelector compact />}
        </div>

        {!location ? (
          <div className="flex flex-col items-start gap-3">
            <p className="text-sm text-muted">
              {t('home.depots.setLocation')}
            </p>
            <LocationSelector />
          </div>
        ) : loading ? (
          <div className="flex flex-col gap-3">
            {Array.from({ length: 2 }).map((_, i) => (
              <Skeleton key={i} className="h-[70px] w-full rounded-xl" />
            ))}
          </div>
        ) : !data || data.length === 0 ? (
          <p className="text-sm text-muted">{t('home.depots.empty')}</p>
        ) : (
          <>
            {data.map((d) => (
              <div
                key={d.id}
                className="flex items-center gap-3 rounded-xl bg-[color:var(--surface-muted)] px-4 py-3.5"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-50">
                  <Storefront size={19} weight="fill" className="text-brand-600" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold">{d.name}</div>
                  <div className="text-xs text-muted">
                    {d.city} ·{' '}
                    {d.withinService ? (
                      <>
                        {t('home.depots.deliveryFee')} <Money amount={d.deliveryFee} />
                      </>
                    ) : (
                      t('home.depots.outOfArea')
                    )}
                  </div>
                </div>
                <Chip tone={d.withinService ? 'success' : 'outline'}>
                  {d.distanceKm.toFixed(1)} km
                </Chip>
              </div>
            ))}
            <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-2 border-t border-app pt-3.5">
              <span className="flex items-center gap-1.5 text-xs font-bold text-muted">
                <Clock size={16} weight="fill" className="text-brand-600" /> {t('home.depots.eta')}
              </span>
              <span className="flex items-center gap-1.5 text-xs font-bold text-muted">
                <ShieldCheck size={16} weight="fill" className="text-brand-600" /> {t('home.depots.sealed')}
              </span>
              <span className="flex items-center gap-1.5 text-xs font-bold text-muted">
                <Wallet size={16} weight="fill" className="text-brand-600" /> COD / QRIS / e-wallet
              </span>
            </div>
          </>
        )}
      </Card>
    </section>
  );
}
