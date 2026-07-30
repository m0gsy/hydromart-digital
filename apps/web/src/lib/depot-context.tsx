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
  /**
   * Why the list is empty. null = genuinely no depots; a message = the fetch failed and the
   * emptiness means nothing. Swallowing this told a cashier "Belum ada depot — pilih depot dulu"
   * when the truth was a 429 from the gateway, and there was no depot to pick.
   */
  error: string | null;
  reload: () => void;
  setSelected: (depotId: string | null) => void;
}

const DepotContext = createContext<DepotContextValue | null>(null);

export function DepotProvider({ children }: { children: React.ReactNode }) {
  const [depots, setDepots] = useState<Depot[]>([]);
  const [selectedId, setLocal] = useState<string | null>(null);
  // Two things must land before a page may decide it has no depot: the stored selection, and the
  // list itself. `ready` used to mean only the first, so every scoped page rendered its "Belum ada
  // depot" empty state for the duration of the fetch — a flash that reads as a real answer.
  const [storedRead, setStoredRead] = useState(false);
  const [listSettled, setListSettled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const ready = storedRead && listSettled;

  useEffect(() => {
    setLocal(getDepot());
    setStoredRead(true);
    return subscribe(setLocal);
  }, []);

  useEffect(() => {
    let alive = true;
    api
      .get<Page<Depot>>(endpoints.depots.browse({ limit: 100 }), true)
      .then((page) => {
        if (!alive) return;
        setDepots(page.items ?? []);
        setError(null);
      })
      .catch((e) => {
        // The rail still renders without the list, but the failure is recorded so a page that
        // needs a depot can say "gagal memuat, coba lagi" instead of "you have no depot".
        if (alive) setError(e instanceof Error ? e.message : 'Gagal memuat daftar depot.');
      })
      .finally(() => {
        if (alive) setListSettled(true);
      });
    return () => {
      alive = false;
    };
  }, [attempt]);

  const value = useMemo<DepotContextValue>(() => {
    const selected = depots.find((d) => d.id === selectedId) ?? null;
    const scopedId = selectedId ?? depots[0]?.id ?? null;
    return {
      depots,
      selectedId,
      selected,
      scopedId,
      ready,
      error,
      reload: () => setAttempt((n) => n + 1),
      setSelected: (id) => setDepot(id),
    };
  }, [depots, selectedId, ready, error]);

  return <DepotContext.Provider value={value}>{children}</DepotContext.Provider>;
}

export function useDepot(): DepotContextValue {
  const ctx = useContext(DepotContext);
  if (!ctx) throw new Error('useDepot must be used within <DepotProvider>');
  return ctx;
}
