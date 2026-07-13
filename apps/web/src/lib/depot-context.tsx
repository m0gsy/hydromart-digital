'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';

import { api } from './api';
import { endpoints } from './endpoints';
import { getDepot, setDepot, subscribe } from './depot-store';
import type { Depot, Page } from './types';

export interface DepotContextValue {
  /** All depots the console can scope to (active, public browse). */
  depots: Depot[];
  /** Selected depot id, or null for "All depots / Semua depot". */
  selectedId: string | null;
  /** The selected Depot record, or null when "All" (or not yet loaded). */
  selected: Depot | null;
  /**
   * A concrete depot id for pages that need exactly one depot (Inventori · Harga ·
   * Perkiraan): the selection, or the first depot when "All" is active.
   */
  scopedId: string | null;
  ready: boolean;
  setSelected: (depotId: string | null) => void;
}

const DepotContext = createContext<DepotContextValue | null>(null);

export function DepotProvider({ children }: { children: React.ReactNode }) {
  const [depots, setDepots] = useState<Depot[]>([]);
  const [selectedId, setLocal] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setLocal(getDepot());
    setReady(true);
    return subscribe(setLocal);
  }, []);

  useEffect(() => {
    let alive = true;
    api
      .get<Page<Depot>>(endpoints.depots.browse({ limit: 100 }), true)
      .then((page) => {
        if (alive) setDepots(page.items ?? []);
      })
      .catch(() => {
        // Rail still renders without the list; scoped pages surface their own error.
      });
    return () => {
      alive = false;
    };
  }, []);

  const value = useMemo<DepotContextValue>(() => {
    const selected = depots.find((d) => d.id === selectedId) ?? null;
    const scopedId = selectedId ?? depots[0]?.id ?? null;
    return {
      depots,
      selectedId,
      selected,
      scopedId,
      ready,
      setSelected: (id) => setDepot(id),
    };
  }, [depots, selectedId, ready]);

  return <DepotContext.Provider value={value}>{children}</DepotContext.Provider>;
}

export function useDepot(): DepotContextValue {
  const ctx = useContext(DepotContext);
  if (!ctx) throw new Error('useDepot must be used within <DepotProvider>');
  return ctx;
}
