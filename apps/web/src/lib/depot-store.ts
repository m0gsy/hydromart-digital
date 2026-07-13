'use client';

// The ops console's globally-selected depot, shared by every depot-scoped page
// (Inventori · Harga · Perkiraan) so they stop re-prompting for a depot. `null`
// means "All depots / Semua depot" (combined view). Persisted to localStorage so
// the selection survives reloads.
//
// ponytail: same module-singleton + subscribe shape as location-store; no reason
// to reach for a state library for one small value.

const KEY = 'hm.depot';
type Listener = (depotId: string | null) => void;

let current: string | null = null;
const listeners = new Set<Listener>();
let hydrated = false;

function hydrate(): void {
  if (hydrated || typeof window === 'undefined') return;
  hydrated = true;
  try {
    current = window.localStorage.getItem(KEY);
  } catch {
    current = null;
  }
}

export function getDepot(): string | null {
  hydrate();
  return current;
}

export function setDepot(depotId: string | null): void {
  hydrate();
  current = depotId;
  if (typeof window !== 'undefined') {
    if (depotId) window.localStorage.setItem(KEY, depotId);
    else window.localStorage.removeItem(KEY);
  }
  listeners.forEach((fn) => fn(depotId));
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
