'use client';

import type { Session } from './types';

// Cached view of the signed-in session, shared by the API client and the React auth
// context (which re-renders on change). Persisted to localStorage.
//
// SEC-4: this holds ONLY the public customer profile — never tokens. The real
// credential is an httpOnly cookie the gateway sets/reads (see session-bff.ts), so
// XSS can't read it here. localStorage is just a UX cache to avoid a logged-out flash
// on load; auth-context revalidates it against `/auth/me` on mount and clears it on 401.

const KEY = 'hm.session';
type Listener = (session: Session | null) => void;

let current: Session | null = null;
const listeners = new Set<Listener>();
let hydrated = false;

function hydrate(): void {
  if (hydrated || typeof window === 'undefined') return;
  hydrated = true;
  try {
    const raw = window.localStorage.getItem(KEY);
    current = raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    current = null;
  }
}

export function getSession(): Session | null {
  hydrate();
  return current;
}

export function setSession(session: Session | null): void {
  hydrate();
  current = session;
  if (typeof window !== 'undefined') {
    if (session) window.localStorage.setItem(KEY, JSON.stringify(session));
    else window.localStorage.removeItem(KEY);
  }
  listeners.forEach((fn) => fn(session));
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
