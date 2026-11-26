import { readFileSync } from 'fs';
import { join } from 'path';

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { LatLng, pointInServiceArea } from '@hydromart/platform';

import { RegionCodes, RegionHit, RegionRef, regionCodesFor } from '../../domain/region-codes';

/** One boundary: BPS code, name, parent code (ADM4 -> its ADM3), bbox [w,s,e,n], polygons. */
export interface RegionFeature {
  c: string;
  n: string;
  p?: string;
  b: [number, number, number, number];
  /** polygons -> rings (first = outer, rest = holes) -> flat [lng, lat, lng, lat, ...] */
  g: number[][][];
}
export interface RegionAsset {
  adm3: RegionFeature[];
  adm4: RegionFeature[];
}

const toRing = (flat: number[]): LatLng[] => {
  const ring: LatLng[] = [];
  for (let i = 0; i < flat.length; i += 2) ring.push({ lng: flat[i]!, lat: flat[i + 1]! });
  return ring;
};

/** Inside an outer ring and in none of its holes (the platform ring test, edges count as inside). */
function inFeature(point: LatLng, f: RegionFeature): boolean {
  const [w, s, e, n] = f.b;
  if (point.lng < w || point.lng > e || point.lat < s || point.lat > n) return false;
  return f.g.some(
    ([outer, ...holes]) =>
      pointInServiceArea(point, [toRing(outer!)]) &&
      !holes.some((h) => pointInServiceArea(point, [toRing(h)])),
  );
}

/**
 * Which kecamatan and kelurahan a pin is in, from BPS boundaries (HDX COD-AB, see
 * data/README.md next to the asset). The file is read once, on first use.
 */
@Injectable()
export class RegionLookup {
  private readonly logger = new Logger(RegionLookup.name);
  private asset: RegionAsset | null;
  private failed = false;
  private readonly byParent = new Map<string, RegionFeature[]>();
  private readonly byCode = new Map<string, RegionFeature>();
  private indexed = false;

  // The token is never provided in the app (the file is read on first use); tests pass an asset.
  constructor(@Optional() @Inject('REGION_ASSET') asset?: RegionAsset) {
    this.asset = asset ?? null;
  }

  /** The asset, or null when it cannot be read: logged once, never retried, never thrown. */
  private load(): RegionAsset | null {
    if (this.failed) return null;
    try {
      this.asset ??= JSON.parse(
        readFileSync(join(__dirname, 'regions.json'), 'utf8'),
      ) as RegionAsset;
      if (!this.indexed) {
        this.indexed = true;
        for (const f of this.asset.adm3) this.byCode.set(f.c, f);
        for (const f of this.asset.adm4) {
          const list = this.byParent.get(f.p!) ?? [];
          list.push(f);
          this.byParent.set(f.p!, list);
        }
      }
      return this.asset;
    } catch (err) {
      this.failed = true;
      this.asset = null;
      this.logger.error(
        `regions.json unreadable; addresses are saved without region codes: ${String(err)}`,
      );
      return null;
    }
  }

  /**
   * Simplified edges overlap or leave gaps of a few tens of metres, so: of the kecamatan that contain
   * the point, prefer the one whose kelurahan does too; with none, scan every kelurahan and take its
   * parent kecamatan.
   */
  find(lat: number, lng: number): RegionHit | null {
    const asset = this.load();
    if (!asset) return null;
    const point = { lat, lng };
    const named = (f: RegionFeature): RegionRef => ({ code: f.c, name: f.n });
    const candidates = asset.adm3.filter((f) => inFeature(point, f));
    for (const kec of candidates) {
      const kel = (this.byParent.get(kec.c) ?? []).find((f) => inFeature(point, f));
      if (kel) return { kecamatan: named(kec), kelurahan: named(kel) };
    }
    if (candidates.length) return { kecamatan: named(candidates[0]!), kelurahan: null };
    const kel = asset.adm4.find((f) => inFeature(point, f));
    const parent = kel && this.byCode.get(kel.p!);
    return kel && parent ? { kecamatan: named(parent), kelurahan: named(kel) } : null;
  }

  /** The codes an address row stores for this pin, honouring how trustworthy the pin is. */
  codesFor(
    lat: number | null | undefined,
    lng: number | null | undefined,
    source: string | null | undefined,
    accuracyM: number | null | undefined,
  ): RegionCodes {
    if (lat == null || lng == null) return regionCodesFor(null, source, accuracyM);
    return regionCodesFor(this.find(lat, lng), source, accuracyM);
  }
}
