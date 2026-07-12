'use client';

import { MapPin, Truck } from '@phosphor-icons/react';

import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAsync } from '@/lib/use-async';
import { useLocation } from '@/lib/location-context';
import { Badge, Card, Money, Skeleton } from '@/components/ui';
import { LocationSelector } from '@/components/location-selector';
import type { NearbyDepot } from '@/lib/types';

// "Depots near me" — depends on the user's chosen location. When no location is
// set yet, it invites the user to pick one (rather than hiding) so guests learn
// the delivery-coverage answer. With a location, it lists nearest depots.

export function NearbyDepots() {
  const { location, ready } = useLocation();

  const { data, loading } = useAsync<NearbyDepot[]>(
    () =>
      location
        ? api.get<NearbyDepot[]>(endpoints.depots.nearby({ lat: location.lat, lng: location.lng, limit: 4 }))
        : Promise.resolve([] as NearbyDepot[]),
    [location?.lat, location?.lng],
  );

  if (!ready) return null;

  return (
    <section className="flex flex-col gap-2" aria-label="Depot terdekat">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-bold">Depot terdekat</h2>
        {location && <LocationSelector compact />}
      </div>

      {!location ? (
        <Card className="flex flex-col items-start gap-3 p-5">
          <p className="text-sm text-muted">
            Atur lokasi untuk melihat depot terdekat dan cek apakah kami mengantar ke area Anda.
          </p>
          <LocationSelector />
        </Card>
      ) : loading ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : !data || data.length === 0 ? (
        <Card className="p-5 text-sm text-muted">Belum ada depot di sekitar lokasi ini.</Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {data.map((d) => (
            <Card key={d.id} className="flex flex-col gap-2 p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 font-semibold">
                  <MapPin size={18} weight="fill" className="text-brand-600" />
                  {d.name}
                </div>
                <Badge tone={d.withinService ? 'success' : 'neutral'}>
                  {d.distanceKm.toFixed(1)} km
                </Badge>
              </div>
              <p className="text-sm text-muted">
                {d.city}, {d.province}
              </p>
              <div className="flex items-center gap-1.5 text-sm">
                <Truck size={16} className="text-muted" />
                {d.withinService ? (
                  <span className="text-muted">
                    Ongkir <Money amount={d.deliveryFee} className="font-semibold text-[color:var(--text)]" />
                  </span>
                ) : (
                  <span className="text-muted">Di luar area antar</span>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}
