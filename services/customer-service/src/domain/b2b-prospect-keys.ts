import { createHmac } from 'node:crypto';

import { haversineMeters } from '@hydromart/platform';

import { DUPLICATE_RADIUS_M, DuplicateProbe } from './b2b-prospect';

/** Words that say what kind of business it is, not which one: dropped from the start of a name. */
const LEADING_NOISE = new Set(['pt', 'cv', 'ud', 'toko', 'warung']);

/**
 * The matching key of a business name: lower case, no accents, letters and digits only, and
 * without a leading legal/shop-type word ("PT Berkah Jaya" and "Berkah Jaya" are one business).
 */
export function normaliseName(name: string): string {
  const tokens = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((t) => t.length > 0);
  while (tokens.length > 1 && LEADING_NOISE.has(tokens[0]!)) tokens.shift();
  return tokens.join('');
}

/**
 * The do-not-contact entry for a key: HMAC-SHA256 (not a plain hash: the Indonesian number space
 * is small enough to brute-force one), so the table can be checked and counted but never read back.
 */
export function dncHash(secret: string, kind: 'PHONE' | 'PLACE', key: string): string {
  return createHmac('sha256', secret).update(`${kind}:${key}`).digest('hex');
}

/** A cell id from `gridCell1km` (`i:j`, either may be negative) and its eight neighbours. */
export function neighbourCells(cell: string): string[] {
  const [i, j] = cell.split(':').map(Number) as [number, number];
  const out: string[] = [];
  for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) out.push(`${i + di}:${j + dj}`);
  return out;
}

/** The place keys to look for: a pin can land in the next 1 km cell on a refresh. */
export function placeKeys(nameKey: string, cell: string): string[] {
  return neighbourCells(cell).map((c) => `${nameKey}|${c}`);
}

/** Why a probe is already known, from candidates the repository found near it (or this file's earlier rows). */
export type DuplicateKind = 'SOURCE_ID' | 'PHONE' | 'NAME_NEAR';

export function matchDuplicate(
  candidates: readonly DuplicateProbe[],
  probe: DuplicateProbe,
): DuplicateKind | null {
  for (const c of candidates) {
    if (probe.sourceId && c.source === probe.source && c.sourceId === probe.sourceId) return 'SOURCE_ID';
    if (probe.phoneE164 && c.phoneE164 === probe.phoneE164) return 'PHONE';
    if (
      c.nameKey === probe.nameKey &&
      haversineMeters(c.latitude, c.longitude, probe.latitude, probe.longitude) <= DUPLICATE_RADIUS_M
    ) {
      return 'NAME_NEAR';
    }
  }
  return null;
}
