/** A BPS-coded administrative area (kecamatan = ADM3, kelurahan/desa = ADM4). */
export interface RegionRef {
  code: string;
  name: string;
}

/** What a pin falls in. `kelurahan` is null when it is in a kecamatan but in no mapped kelurahan. */
export interface RegionHit {
  kecamatan: RegionRef;
  kelurahan: RegionRef | null;
}

export interface RegionCodes {
  kecamatanCode: string | null;
  kelurahanCode: string | null;
  regionSource: 'PIN' | null;
}

export const NO_REGION: RegionCodes = { kecamatanCode: null, kelurahanCode: null, regionSource: null };

/** A pin worse than this cannot tell which kecamatan it is in; worse than the second, which kelurahan. */
export const KECAMATAN_MAX_ACCURACY_M = 1000;
export const KELURAHAN_MAX_ACCURACY_M = 250;

/**
 * How much of a region a pin may claim. Never a guess: a pin too coarse for a level leaves that
 * level null.
 *  - a GPS fix: by its reported accuracy (no accuracy reported = unknown = nothing);
 *  - a pin a person placed on the map (MANUAL, STAFF): both levels, there is no GPS error;
 *  - no known quality (saved before it was kept, IMPORT, COURIER): kecamatan only.
 */
export function regionLevels(
  source: string | null | undefined,
  accuracyM: number | null | undefined,
): { kecamatan: boolean; kelurahan: boolean } {
  if (accuracyM != null) {
    return {
      kecamatan: accuracyM <= KECAMATAN_MAX_ACCURACY_M,
      kelurahan: accuracyM <= KELURAHAN_MAX_ACCURACY_M,
    };
  }
  if (source === 'GPS') return { kecamatan: false, kelurahan: false };
  const placed = source === 'MANUAL' || source === 'STAFF';
  return { kecamatan: true, kelurahan: placed };
}

export function regionCodesFor(
  hit: RegionHit | null,
  source: string | null | undefined,
  accuracyM: number | null | undefined,
): RegionCodes {
  if (!hit) return NO_REGION;
  const level = regionLevels(source, accuracyM);
  if (!level.kecamatan) return NO_REGION;
  return {
    kecamatanCode: hit.kecamatan.code,
    kelurahanCode: level.kelurahan ? (hit.kelurahan?.code ?? null) : null,
    regionSource: 'PIN',
  };
}
