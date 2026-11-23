/**
 * HD-8 (Plan Eksekusi): where a visitor came from, kept in this browser until a signup or a
 * /waralaba application carries it to the server. The attribution rule: the first source
 * stays, the latest is kept beside it.
 *
 * A source is the campaign code of a coded link: `?src=` (ours: a QR at an exhibition, a depot
 * poster), else `?utm_source=` (what ad platforms add). It is lower-cased, and anything not of
 * the shape below is ignored, never stored. Only the code is kept: no visit, no time, no
 * identifier. The privacy policy says so ("Data yang kami kumpulkan").
 */

/** The same pattern auth-service and depot-service check (test/legal-versions.test.ts). */
export const SOURCE_CODE_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

const KEY = 'hydromart.source';

export interface Sources {
  firstSource?: string;
  lastSource?: string;
}

/** Null where storage is blocked (some private modes throw on the mere access). */
function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const valid = (v: unknown): v is string => typeof v === 'string' && SOURCE_CODE_PATTERN.test(v);

/** What a submission sends: both codes, or nothing when no coded link was followed. */
export function readSources(): Sources {
  try {
    const saved = JSON.parse(storage()?.getItem(KEY) ?? 'null') as Record<string, unknown> | null;
    if (!saved) return {};
    return {
      ...(valid(saved.first) ? { firstSource: saved.first } : {}),
      ...(valid(saved.last) ? { lastSource: saved.last } : {}),
    };
  } catch {
    return {};
  }
}

/** Records the code of the link this page was opened by, if it carries one. */
export function captureSource(search: string): void {
  const params = new URLSearchParams(search);
  const code = (params.get('src') ?? params.get('utm_source') ?? '').trim().toLowerCase();
  if (!valid(code)) return;
  try {
    storage()?.setItem(KEY, JSON.stringify({ first: readSources().firstSource ?? code, last: code }));
  } catch {
    // Full or blocked storage: this visit simply goes unattributed.
  }
}
