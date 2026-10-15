'use client';

/**
 * Which paper the till's printer takes. A per-device convenience, not shared state: it is
 * a fact about the roll in THIS cashier's printer, so it lives in the browser and never
 * reaches the server. Every read and write is guarded — storage throws in a private window
 * and with site data blocked, and a receipt must still print when it does.
 */
export type PaperMm = 58 | 80;

const KEY = 'hm.printer.paperMm';

/** Characters per line at the printer's default font. 32 on 58 mm, 48 on 80 mm. */
export const COLUMNS: Record<PaperMm, number> = { 58: 32, 80: 48 };

/** Unset reads as null so callers can tell "never chose" from "chose 58". */
export function getPaperMm(): PaperMm | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw === '58' ? 58 : raw === '80' ? 80 : null;
  } catch {
    return null;
  }
}

export function setPaperMm(mm: PaperMm | null): void {
  try {
    if (mm === null) window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, String(mm));
  } catch {
    // Not stored: the next print falls back to 58 mm, which is the width that cannot clip.
  }
}
