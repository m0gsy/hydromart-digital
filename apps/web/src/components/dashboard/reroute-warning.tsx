'use client';

import { useCallback, useState } from 'react';

import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import type { SubscriptionReroutePreview } from '@/lib/types';

/** The depot change a save or a deactivation is about to make (absent = unchanged). */
export interface DepotChange {
  depotId: string;
  active?: false;
  lat?: number;
  lng?: number;
  serviceRadiusKm?: number;
  /** A redrawn area; null clears it, so the radius decides again. */
  serviceArea?: { lat: number; lng: number }[][] | null;
}

/**
 * P3-4: the dry run before a depot change. The sweep routes every subscription by its pin,
 * so moving a depot, redrawing or shrinking where it delivers, or deactivating it re-routes
 * subscribers silently. Answers the preview only when somebody actually moves; null
 * otherwise, and null when the preview could not be read — it warns, it never locks a save
 * (owner default 2026-11-20).
 */
export async function rerouteImpact(
  change: DepotChange,
): Promise<SubscriptionReroutePreview | null> {
  try {
    const r = await api.post<SubscriptionReroutePreview>(
      endpoints.subscriptions.reroutePreview,
      change,
      true,
    );
    return r.affected > 0 ? r : null;
  } catch {
    return null;
  }
}

/** Whether an edit moves the depot or changes its radius. */
export function movesDepot(
  before: { lat: number; lng: number; serviceRadiusKm: number },
  after: { lat: number; lng: number; serviceRadiusKm?: number },
): boolean {
  return (
    after.lat !== before.lat ||
    after.lng !== before.lng ||
    (after.serviceRadiusKm !== undefined && after.serviceRadiusKm !== before.serviceRadiusKm)
  );
}

/**
 * The first press asks, the second press goes ahead — for exactly the change that was shown.
 * Keyed by the change itself, so an edit made after the warning (or while it was being
 * fetched) is asked about again, and a deactivation after a re-activation is too.
 */
export function useRerouteGate() {
  const [gate, setGate] = useState<{ key: string; impact: SubscriptionReroutePreview } | null>(
    null,
  );
  const reset = useCallback(() => setGate(null), []);
  /** True: go ahead. False: a warning is on screen now; the next press with the same change saves. */
  const check = useCallback(
    async (change: DepotChange): Promise<boolean> => {
      const key = JSON.stringify(change);
      if (gate?.key === key) return true;
      const impact = await rerouteImpact(change);
      setGate(impact ? { key, impact } : null);
      return impact === null;
    },
    [gate],
  );
  return { impact: gate?.impact ?? null, check, reset };
}

/** Said before the second press that saves anyway. */
export function RerouteWarning({ impact }: { impact: SubscriptionReroutePreview }) {
  const { t } = useT();
  return (
    <p
      role="alert"
      className="rounded-xl bg-[color:var(--warning-bg)] p-3 text-sm font-medium text-[color:var(--warning)]"
    >
      {t('hq.reroute.affected', { n: impact.affected })}
      {impact.unserved > 0 && ` ${t('hq.suspend.impact.unserved', { n: impact.unserved })}.`}{' '}
      {t('hq.reroute.again')}
    </p>
  );
}
