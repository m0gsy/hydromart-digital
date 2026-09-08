'use client';

import { useEffect } from 'react';

/**
 * CA-4-34 — stop the Android back button from silently throwing away a half-filled form.
 *
 * The proof-of-delivery form is the case this was written for: a photo taken at the door,
 * a recipient's name typed on a phone, a signature drawn by hand. It had no exit control at
 * all, so the only way out was the system back button — which left the page and took all
 * three with it, with no question asked. A courier who tapped it by reflex went back to the
 * door and did the whole handover again.
 *
 * How it works: while `dirty` is true, one extra history entry is pushed. The back gesture
 * then pops THAT entry instead of leaving the page, and `onBack` decides what happens. If
 * the user says "stay", the entry is pushed again so the next back press is caught too.
 *
 * `beforeunload` covers the other exits a browser has — a closed tab, a typed URL, a
 * refresh. Mobile browsers may ignore it; it is a second line, not the mechanism.
 */
export function useDiscardGuard(dirty: boolean, onBack: () => void | Promise<void>): void {
  useEffect(() => {
    if (!dirty) return;

    window.history.pushState({ hydromartDiscardGuard: true }, '');

    const onPopState = () => void onBack();
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Chrome shows its own wording and ignores any string; returnValue is what actually
      // arms the prompt.
      e.returnValue = '';
    };

    window.addEventListener('popstate', onPopState);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [dirty, onBack]);
}
