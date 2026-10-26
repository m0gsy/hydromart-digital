/**
 * Cell parsers for the depot import sheet. Pure, so each one is testable without a file.
 *
 * Separators are chosen against Excel's own habits: an id-ID Excel saves CSV with `;` and
 * writes a decimal COMMA, so neither can delimit anything inside a cell. Items inside one
 * cell are split on `|`, rings on `#`, a label on the first `:`, a coordinate pair on `,`.
 */
type Translate = (key: string, vars?: Record<string, string | number>) => string;
const passthrough: Translate = (key) => key;

const pad = (n: number): string => String(n).padStart(2, '0');

/** `08:00` or `8.00` or `8:00` → `08:00`. A real time cell is refused, not guessed at. */
export function hhmmCell(raw: string, t: Translate = passthrough): string {
  const m = /^(\d{1,2})[:.](\d{2})$/.exec(raw.trim());
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) {
    throw new Error(t('hrFix.depotImport.notATime', { value: raw }));
  }
  return `${pad(Number(m[1]))}:${m[2]}`;
}

/** Plain `YYYY-MM-DD`, not the ISO instant `dateCell` produces: a closure date has no time. */
function plainDate(raw: string, t: Translate): string {
  const value = raw.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const d = m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
  if (!m || !d || d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) {
    throw new Error(t('hrFix.depotImport.notADate', { value: raw }));
  }
  return value;
}

/** `2026-08-17:Hari Kemerdekaan|2026-12-25` → `[{date,label?},…]`. */
export function holidaysCell(
  raw: string,
  t: Translate = passthrough,
): { date: string; label?: string }[] {
  return raw
    .split('|')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const at = item.indexOf(':');
      const date = plainDate(at === -1 ? item : item.slice(0, at), t);
      const label = at === -1 ? '' : item.slice(at + 1).trim();
      return label ? { date, label } : { date };
    });
}

function coordinate(raw: string, min: number, max: number, t: Translate): number {
  const text = raw.trim();
  // Number('') is 0, and a stray space or a second dot would otherwise be a silent wrong place.
  const n = /^-?\d+(\.\d+)?$/.test(text) ? Number(text) : NaN;
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new Error(t('hrFix.depotImport.badCoordinate', { value: raw }));
  }
  return n;
}

/**
 * `lat,lng|lat,lng|lat,lng#lat,lng|…` → polygons. Dot decimals only: a comma here is the
 * pair separator, so a decimal comma would shift every number after it by one place.
 * Whether the ring is a real region (no crossings, 3+ corners) is the server's call.
 */
export function areaCell(
  raw: string,
  t: Translate = passthrough,
): { lat: number; lng: number }[][] {
  return raw
    .split('#')
    .map((ring) => ring.trim())
    .filter(Boolean)
    .map((ring) =>
      ring
        .split('|')
        .map((pair) => pair.trim())
        .filter(Boolean)
        .map((pair) => {
          const [latRaw, lngRaw, extra] = pair.split(',');
          if (latRaw === undefined || lngRaw === undefined || extra !== undefined) {
            throw new Error(t('hrFix.depotImport.badPair', { value: pair }));
          }
          return {
            lat: coordinate(latRaw, -90, 90, t),
            lng: coordinate(lngRaw, -180, 180, t),
          };
        }),
    );
}

/** Account numbers and QRIS ids: Excel turns a long digit string into 1.23E+14. */
export function plainDigitsCell(raw: string, t: Translate = passthrough): string {
  const value = raw.trim();
  if (/e[+-]?\d+$/i.test(value)) throw new Error(t('hrFix.depotImport.scientific', { value: raw }));
  return value;
}
