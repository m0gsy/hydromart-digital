'use client';

import { useState } from 'react';
import { CaretDown, Check, Crosshair, MapPin } from '@phosphor-icons/react';

import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAsync } from '@/lib/use-async';
import { useLocation } from '@/lib/location-context';
import { useT } from '@/lib/locale-context';
import type { DepotAdmin, NearbyDepot, Page } from '@/lib/types';

// Delivery-location control for the Home hero. Two ways to set a location:
// browser geolocation ("use my location"), or pick a depot's city from the
// public depot list. The chosen point is persisted (see location-store) and
// reused by the "depots near me" section and depot-scoped trending.

export function LocationSelector({ compact }: { compact?: boolean }) {
  const { location, setLocation } = useLocation();
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [geoBusy, setGeoBusy] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);

  // Public depot list for the manual picker (loaded only when the panel opens).
  const { data: depots } = useAsync<Page<DepotAdmin>>(
    () => (open ? api.get(endpoints.depots.browse({ limit: 50 })) : Promise.resolve(null as never)),
    [open],
  );

  async function useMyLocation() {
    setGeoError(null);
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGeoError(t('home.location.unsupported'));
      return;
    }
    setGeoBusy(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        // Resolve the nearest depot so we can label the pin and scope trending.
        let depotId: string | undefined;
        let label = t('home.location.myLocation');
        try {
          const near = await api.get<NearbyDepot[]>(endpoints.depots.nearby({ lat, lng, limit: 1 }));
          if (near[0]) {
            depotId = near[0].id;
            label = near[0].withinService
              ? t('home.location.near', { city: near[0].city })
              : t('home.location.myLocation');
          }
        } catch {
          /* nearby is best-effort; still set the raw coords */
        }
        setLocation({ label, lat, lng, depotId });
        setGeoBusy(false);
        setOpen(false);
      },
      () => {
        setGeoError(t('home.location.denied'));
        setGeoBusy(false);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  function pickDepot(d: DepotAdmin) {
    setLocation({ label: d.city, lat: d.lat, lng: d.lng, depotId: d.id });
    setOpen(false);
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={
          compact
            ? 'flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-semibold hover:bg-brand-50'
            : 'flex items-center gap-2 rounded-lg border border-app px-3 py-2 text-sm font-semibold hover:bg-brand-50'
        }
      >
        <MapPin size={18} weight="fill" className="text-brand-600" />
        <span className="max-w-[10rem] truncate">
          {location ? location.label : t('home.location.placeholder')}
        </span>
        <CaretDown size={14} className="text-muted" />
      </button>

      {open && (
        <div className="surface absolute left-0 z-20 mt-2 w-72 rounded-xl border border-app p-2 shadow-lg">
          <button
            onClick={useMyLocation}
            disabled={geoBusy}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold hover:bg-brand-50 disabled:opacity-50"
          >
            <Crosshair size={18} className="text-brand-600" />
            {geoBusy ? t('home.location.searching') : t('home.location.useMyLocation')}
          </button>
          {geoError && <p className="px-3 py-1 text-xs text-red-600">{geoError}</p>}

          <div className="mt-1 border-t border-app pt-1">
            <p className="px-3 py-1 text-xs font-semibold text-muted">{t('home.location.orPickCity')}</p>
            <ul className="max-h-56 overflow-y-auto">
              {(depots?.items ?? []).map((d) => (
                <li key={d.id}>
                  <button
                    onClick={() => pickDepot(d)}
                    className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-brand-50"
                  >
                    <span className="truncate">
                      {d.city} · <span className="text-muted">{d.name}</span>
                    </span>
                    {location?.depotId === d.id && <Check size={16} className="text-brand-600" />}
                  </button>
                </li>
              ))}
              {depots && depots.items.length === 0 && (
                <li className="px-3 py-2 text-sm text-muted">{t('home.location.noDepots')}</li>
              )}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
