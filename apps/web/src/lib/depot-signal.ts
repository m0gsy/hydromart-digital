// Two small hooks between the API client and the auth context, kept in their own module so
// neither has to import the other: the client says "the server reports your depot moved",
// the auth context listens, and asks the client to take a fresh token.

let depotChangedHandler: ((depotId: string) => void) | null = null;

/** Register who hears "the server says your depot changed" (one listener: the auth context). */
export function onDepotChanged(handler: ((depotId: string) => void) | null): void {
  depotChangedHandler = handler;
}

/** Called by the API client when a response carries `x-hm-depot-changed`. */
export function notifyDepotChanged(depotId: string): void {
  depotChangedHandler?.(depotId);
}

let refresher: (() => Promise<unknown>) | null = null;

/** The API client hands over its single-flight refresh once, when it loads. */
export function registerRefresher(fn: () => Promise<unknown>): void {
  refresher = fn;
}

/** Take a fresh token now. Resolves null when no client is loaded to do it. */
export async function refreshNow(): Promise<unknown> {
  return refresher ? refresher() : null;
}
