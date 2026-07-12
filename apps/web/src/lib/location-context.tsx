'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';

import { getLocation, setLocation, subscribe } from './location-store';
import type { UserLocation } from './location-store';

interface LocationValue {
  location: UserLocation | null;
  /** true once the persisted location has hydrated (avoids a first-paint flash). */
  ready: boolean;
  setLocation: (location: UserLocation | null) => void;
  clear: () => void;
}

const LocationContext = createContext<LocationValue | null>(null);

export function LocationProvider({ children }: { children: React.ReactNode }) {
  const [location, setLocal] = useState<UserLocation | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setLocal(getLocation());
    setReady(true);
    return subscribe(setLocal);
  }, []);

  const value = useMemo<LocationValue>(
    () => ({
      location,
      ready,
      setLocation: (l) => setLocation(l),
      clear: () => setLocation(null),
    }),
    [location, ready],
  );

  return <LocationContext.Provider value={value}>{children}</LocationContext.Provider>;
}

export function useLocation(): LocationValue {
  const ctx = useContext(LocationContext);
  if (!ctx) throw new Error('useLocation must be used within <LocationProvider>');
  return ctx;
}
