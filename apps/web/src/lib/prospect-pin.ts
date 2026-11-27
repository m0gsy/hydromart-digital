export interface Pin {
  lat: number;
  lng: number;
}

const COORD = /^-?\d+(\.\d+)?$/;

/** Whether a fix is a usable pin: finite, on the globe, and not the (0, 0) a missing fix reads as. */
export function validPin(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0)
  );
}

/**
 * "-6.2, 106.8" (comma, semicolon or space between the two numbers; decimal POINT only: a decimal
 * comma would split into four tokens and is refused rather than read as a wrong place).
 */
export function parsePin(text: string): Pin | null {
  const tokens = text.trim().split(/[\s,;]+/);
  if (tokens.length !== 2 || !tokens.every((x) => COORD.test(x))) return null;
  const [lat, lng] = tokens.map(Number) as [number, number];
  return validPin(lat, lng) ? { lat, lng } : null;
}
