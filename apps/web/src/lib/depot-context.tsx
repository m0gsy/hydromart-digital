'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';

import { api } from './api';
import { endpoints } from './endpoints';
import { getDepot, setDepot, subscribe } from './depot-store';
import { getSession, subscribe as subscribeSession } from './session-store';
import type { Depot } from './types';

export interface DepotContextValue {
  /**
   * The depots this console may scope to — the SIGNED-IN account's own set, straight from
   * `GET /depots/scope`, which answers with exactly what `depotScopeIds` lets the API serve.
   *
   * It used to be the anonymous network browse. Nothing about that list belonged to the
   * person reading it: a kepala depot in Bandung opened the console on whichever depot the
   * network returned first, `scopedId` handed that id to every screen underneath, and the
   * mobile manager console — which has no switcher to correct it with — asked for that
   * depot's approvals forever. The switcher can no longer offer a depot the API refuses.
   */
  depots: Depot[];
  /** Selected depot id, or null for "All depots / Semua depot". */
  selectedId: string | null;
  /** The selected Depot record, or null when "All" (or not yet loaded). */
  selected: Depot | null;
  /**
   * A concrete depot id for pages that need exactly one depot (Inventori · Harga ·
   * Perkiraan): the selection, or the first depot in scope when "All" is active.
   *
   * A stored selection outside the list is ignored rather than passed on. The selection
   * outlives a sign-out (it is in localStorage), so the next person to sign in on the same
   * phone inherited the previous one's depot — an id their own token is refused for, which
   * every screen then reported as an error instead of simply scoping to their own depot.
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
  // Whoever is signed in. The provider mounts once for the whole app — including on /login, where
  // nobody is — and used to fetch the list exactly then and never again. Signing in therefore left
  // the console holding the signed-out answer (an empty list) until a full page reload, which is
  // how a cashier reached the counter screen and was told "Belum ada depot".
  const [accountId, setAccountId] = useState<string | null>(getSession()?.customer?.id ?? null);
  const ready = storedRead && listSettled;

  useEffect(() => {
    setLocal(getDepot());
    setStoredRead(true);
    return subscribe(setLocal);
  }, []);

  useEffect(
    () => subscribeSession((session) => setAccountId(session?.customer?.id ?? null)),
    [],
  );

  useEffect(() => {
    let alive = true;
    setListSettled(false);
    api
      .get<Depot[]>(endpoints.depots.scope, true)
      .then((items) => {
        if (!alive) return;
        setDepots(items ?? []);
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
    // Refetch when the signed-in account changes: signing in, signing out, or switching user all
    // change which depots the caller may see.
  }, [attempt, accountId]);

  const value = useMemo<DepotContextValue>(() => {
    const selected = depots.find((d) => d.id === selectedId) ?? null;
    const inScope = selectedId !== null && selected !== null;
    const scopedId = (inScope ? selectedId : depots[0]?.id) ?? null;
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
