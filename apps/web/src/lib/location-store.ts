'use client';

// The customer's chosen delivery location, shared by the Home hero, the
// "depots near me" section, and depot-scoped trending. Persisted to localStorage
// so it survives reloads. Separate from the address book: this is a lightweight
// "where am I ordering to right now" hint, not a saved address.
//
// ponytail: same module-singleton + subscribe shape as session-store; no reason
// to reach for a state library for one small value.

export interface UserLocation {
  /** Human label shown in the UI, e.g. a city name or "My location". */
  label: string;
  lat: number;
  lng: number;
  /** Nearest depot id, when known — lets callers scope trending to a depot. */
  depotId?: string;
}

const KEY = 'hm.location';
type Listener = (location: UserLocation | null) => void;

let current: UserLocation | null = null;
const listeners = new Set<Listener>();
let hydrated = false;

function hydrate(): void {
  if (hydrated || typeof window === 'undefined') return;
  hydrated = true;
  try {
    const raw = window.localStorage.getItem(KEY);
    current = raw ? (JSON.parse(raw) as UserLocation) : null;
  } catch {
    current = null;
  }
}

export function getLocation(): UserLocation | null {
  hydrate();
  return current;
}

export function setLocation(location: UserLocation | null): void {
  hydrate();
  current = location;
  if (typeof window !== 'undefined') {
    if (location) window.localStorage.setItem(KEY, JSON.stringify(location));
    else window.localStorage.removeItem(KEY);
  }
  listeners.forEach((fn) => fn(location));
}

/**
 * The depot the cart should be priced at when a screen has no better answer (A2).
 *
 * Read from the store rather than a hook so the non-React callers — the add-to-cart
 * buttons scattered across product cards and rails — can send it too. They all adopt the
 * CartView their own mutation returns, so one of them omitting the depot would put
 * catalog prices into the shared cart the checkout screen then reads.
 */
export function cartDepotId(): string | null {
  return getLocation()?.depotId ?? null;
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
