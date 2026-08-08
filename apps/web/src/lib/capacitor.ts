'use client';

/**
 * The Capacitor bridge, reached at runtime instead of imported.
 *
 * `apps/web` deliberately takes no dependency on `@capacitor/*`. The plugins are
 * declared once, in `mobile/package.json`, because that is the project `cap sync` reads
 * to assemble the native side — listing them here as well would mean two version numbers
 * that must agree, with nothing checking that they do, and a silent mismatch between the
 * JS calling a plugin and the native code answering it. It also keeps the browser bundle
 * exactly as it was: nothing is added to the web build for a shell the web never loads.
 *
 * The cost is that these calls are not type-checked against the plugin's own types, so
 * every one of them is declared here, in one file, with the shape it expects — and each
 * is exercised by the device checklist in `docs/MOBILE_APPS_PLAN.md` before release.
 * The same hand-rolled-adapter trade the repo already makes for web-push and FCM.
 */

type PluginCall = (options?: Record<string, unknown>) => Promise<unknown>;

interface CapacitorGlobal {
  Plugins?: Record<string, Record<string, PluginCall> | undefined>;
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  convertFileSrc?: (url: string) => string;
}

function bridge(): CapacitorGlobal | undefined {
  return typeof window === 'undefined'
    ? undefined
    : (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
}

/**
 * Call a plugin method, or answer `false` if the plugin is not there.
 *
 * Never throws and never rejects into a caller that has nowhere to show an error: a
 * missing plugin is a build mistake, and a failing one is a phone-specific problem
 * (no share targets, storage full). Both must degrade to "the button did nothing"
 * rather than to a white screen.
 */
export function callPlugin(
  plugin: string,
  method: string,
  options?: Record<string, unknown>,
): boolean {
  const fn = bridge()?.Plugins?.[plugin]?.[method];
  if (typeof fn !== 'function') return false;
  try {
    void Promise.resolve(fn(options)).catch(() => {});
  } catch {
    return false;
  }
  return true;
}

/** Same, but the caller needs the result. Resolves to null when the plugin is absent. */
export async function askPlugin<T>(
  plugin: string,
  method: string,
  options?: Record<string, unknown>,
): Promise<T | null> {
  const fn = bridge()?.Plugins?.[plugin]?.[method];
  if (typeof fn !== 'function') return null;
  try {
    return (await fn(options)) as T;
  } catch {
    return null;
  }
}

/**
 * Subscribe to a plugin event. Returns a cleanup function, always — an absent plugin
 * gives a no-op, so no caller needs a null check in its `useEffect`.
 */
export function onPluginEvent(
  plugin: string,
  event: string,
  handler: (payload: never) => void,
): () => void {
  const target = bridge()?.Plugins?.[plugin] as
    | { addListener?: (e: string, h: (p: never) => void) => Promise<{ remove: () => void }> }
    | undefined;
  if (typeof target?.addListener !== 'function') return () => {};
  const handle = target.addListener(event, handler);
  return () => {
    void handle.then((h) => h.remove()).catch(() => {});
  };
}
