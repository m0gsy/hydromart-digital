'use client';

import { api } from './api';
import { endpoints } from './endpoints';
import { useAsync } from './use-async';

export interface DepotContact {
  name: string | null;
  phone: string | null;
}

/**
 * The depot's name and own phone, for the line under the struk header.
 *
 * Its own read because the public depot projection leaves `contactPhone` out on purpose —
 * one depot at a time to a signed-in caller is fine, a bulk directory of every depot's line
 * is not — so `useDepot()` cannot supply it.
 *
 * Never an error and never a block: a depot with no phone, a 404, a network blip all answer
 * `null`, and the struk prints without the line. A receipt must not wait on a phone number.
 */
export function useDepotContact(depotId: string | null | undefined): DepotContact | null {
  const { data } = useAsync<DepotContact | null>(async () => {
    if (!depotId) return null;
    try {
      const res = await api.get<{ name?: string | null; contactPhone?: string | null }>(
        endpoints.depots.contact(depotId),
        true,
      );
      return { name: res?.name ?? null, phone: res?.contactPhone?.trim() || null };
    } catch {
      return null;
    }
  }, [depotId]);
  return data;
}
