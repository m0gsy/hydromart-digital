/**
 * localStorage that never throws (WEB-14).
 *
 * Some private modes and cookie policies make `localStorage` throw on EVERY access. The root
 * providers (locale, theme, onboarding, session cache) read it in an effect, so one blocked
 * store used to take the whole app down to the global error page. A UX preference that cannot
 * be saved is not worth that: reads answer null, writes are dropped.
 */
export const safeStorage = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* blocked or full: the preference simply is not remembered */
    }
  },
  remove(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch {
      /* see set */
    }
  },
};
