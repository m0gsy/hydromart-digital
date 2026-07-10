'use client';

import type { Session } from './types';

// Single source of truth for the auth session, shared by the API client (which
// needs the token to attach headers and rotate on refresh) and the React auth
// context (which needs to re-render on change). Persisted to localStorage.
//
// ponytail: localStorage bearer tokens, not httpOnly cookies. Fine for this
// customer app; upgrade to a cookie-based BFF session if the XSS surface grows.

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
