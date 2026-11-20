/**
 * A map pin from what a person can paste: "-6.914744, 107.609810", or a Google Maps link that
 * carries one. Used by the imports (2026-11-20) and by the staff pin correction that follows.
 *
 * "!3d…!4d…" is the dropped pin and wins over "@…", which is only where the map was looking.
 * A short link (maps.app.goo.gl, goo.gl/maps) carries no coordinates: it is refused with what
 * to do instead, rather than resolved over the network from a server.
 */
export class PinLocationError extends Error {}

const SHORT_LINK = /(maps\.app\.goo\.gl|goo\.gl\/maps)/i;

export function parseLocation(text: string): { latitude: number; longitude: number } {
  if (SHORT_LINK.test(text)) {
    throw new PinLocationError(
      'Link pendek Google Maps tidak bisa dibaca — buka linknya, lalu salin koordinat atau URL lengkapnya.',
    );
  }
  let t = text;
  try {
    t = decodeURIComponent(t);
  } catch {
    /* a stray % — read the text as it is */
  }
  // After decoding (a %E2%88%92 is a minus too): every dash a phone or Word puts in is a minus,
  // or "–6.9" reads as +6.9 — a pin 1,500 km north, in the sea. And "-6.9,+107.6" is how a
  // search link encodes the space.
  t = t.replace(/[−–—]/g, '-').replace(/,\+/g, ', ');
  const PAIR = String.raw`(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)`;
  const m =
    // The dropped pin.
    /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/.exec(t) ??
    // What was searched for, before where the map happened to be looking ("@…").
    new RegExp(String.raw`(?:[?&](?:q|query|ll|destination)=|/search/|/place/)` + PAIR).exec(t) ??
    // Anything else (plain pasted text, or a bare "@" view): not inside a longer number, so
    // "107.6098, -6.9147" (lng first) is refused, not read as 7.6098.
    new RegExp(String.raw`(?<![\d.])` + PAIR).exec(t);
  if (!m) throw new PinLocationError('Tidak ada koordinat di situ. Contoh: -6.914744, 107.609810');
  return checkedPin(Number(m[1]), Number(m[2]));
}

/** Both halves, in range, and not 0,0 (the Atlantic: what an emptied cell becomes). */
export function checkedPin(latitude: number, longitude: number): { latitude: number; longitude: number } {
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180 ||
    (latitude === 0 && longitude === 0)
  ) {
    throw new PinLocationError('Koordinat di luar jangkauan, atau 0,0.');
  }
  return { latitude, longitude };
}

/**
 * The pin an import row brings, if any: latitude + longitude columns (both, or neither), else a
 * Maps link. Throws PinLocationError with the reason, which becomes that row's failure.
 */
export function pinFromRow(row: {
  latitude?: number;
  longitude?: number;
  mapsLink?: string;
}): { latitude: number; longitude: number } | null {
  const hasLat = row.latitude != null;
  const hasLng = row.longitude != null;
  if (hasLat || hasLng) {
    if (!hasLat || !hasLng) {
      throw new PinLocationError('Isi kolom latitude dan longitude bersamaan.');
    }
    return checkedPin(row.latitude!, row.longitude!);
  }
  return row.mapsLink?.trim() ? parseLocation(row.mapsLink) : null;
}
