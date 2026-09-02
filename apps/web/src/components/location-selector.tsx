'use client';

import { useState } from 'react';
import { CaretDown, Check, Crosshair, MapPin } from '@phosphor-icons/react';

import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { currentPosition, geoReason } from '@/lib/geo';
import { servingDepot } from '@/lib/depots';
import { useAsync } from '@/lib/use-async';
import { useLocation } from '@/lib/location-context';
import { useT } from '@/lib/locale-context';
import type { DepotAdmin, NearbyDepot, Page } from '@/lib/types';
import { FormError, LoadError } from '@/components/ui';

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
  const { data: depots, error: depotsError, reload: reloadDepots } = useAsync<Page<DepotAdmin>>(
    () => (open ? api.get(endpoints.depots.browse({ limit: 50 })) : Promise.resolve(null as never)),
    [open],
  );

  async function useMyLocation() {
    setGeoError(null);
    setGeoBusy(true);
    try {
      // `currentPosition` rather than a fourth copy of `getCurrentPosition`: it retries on
      // the coarse provider before giving up, and it says WHICH failure happened, so this
      // screen no longer tells someone to grant a permission they already granted.
      const pos = await currentPosition();
      {
        const { latitude: lat, longitude: lng } = pos.coords;
        // Resolve the nearest depot so we can label the pin and scope trending.
        let depotId: string | undefined;
        let label = t('home.location.myLocation');
        try {
          // A3/G3: only a depot whose radius COVERS this point may be stored. The old code
          // took `near[0]` whichever it was and merely softened the label — so a customer
          // 15 km outside every radius carried an unusable depot id around, and G3 (which
          // defaults checkout's depot from exactly this value) would have handed checkout a
          // depot the server refuses. Ten candidates because radii differ per depot.
          const near = await api.get<NearbyDepot[]>(endpoints.depots.nearby({ lat, lng, limit: 10 }));
          const serving = servingDepot(near);
          if (serving) {
            depotId = serving.id;
            label = t('home.location.near', { city: serving.city });
          }
        } catch {
          /* nearby is best-effort; still set the raw coords */
        }
        setLocation({ label, lat, lng, depotId });
        setOpen(false);
      }
    } catch (err) {
      const reason = geoReason(err);
      setGeoError(t(`home.location.${reason}`));
    } finally {
      setGeoBusy(false);
    }
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
        <div
          className={
            'surface absolute z-20 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-app p-2 shadow-lg ' +
            /*
             * `right-0` anchors the panel's RIGHT edge to the trigger's, which opens it
             * leftward — correct beside a right-hand card header, and wrong in the app bar,
             * where the trigger sits at the left of a 360pt screen and 288pt of panel then
             * runs off the left edge. `max-w` caps the width; it cannot move the box back
             * on screen. Photographed on a real phone: the list read "encari lokasi…".
             *
             * Phones anchor left, where the trigger always is. The right-anchored form
             * returns from `sm:` up, where the card header it was drawn for lives.
             */
            (compact ? 'left-0 sm:left-auto sm:right-0' : 'left-0')
          }
        >
          <button
            onClick={useMyLocation}
            disabled={geoBusy}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold hover:bg-brand-50 disabled:opacity-50"
          >
            <Crosshair size={18} className="text-brand-600" />
            {geoBusy ? t('home.location.searching') : t('home.location.useMyLocation')}
          </button>
          <FormError message={geoError} className="px-3 py-1 text-xs" />

          <div className="mt-1 border-t border-app pt-1">
            <p className="px-3 py-1 text-xs font-semibold text-muted">{t('home.location.orPickCity')}</p>
            {/* A5. `overscroll-contain`: without it, flicking past the end of this list
                hands the gesture to the page behind, so the panel stays open while the
                screen underneath scrolls away — on a phone that reads as the app losing
                track of the tap. */}
            <ul className="max-h-56 overflow-y-auto overscroll-contain">
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
              {depotsError && (
                /* An unread list leaves the picker silently empty, so the only way left to
                   set a location is geolocation — which is exactly what a shopper who
                   declined the permission cannot use. */
                <li className="px-3 py-2">
                  <LoadError onRetry={reloadDepots} />
                </li>
              )}
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
