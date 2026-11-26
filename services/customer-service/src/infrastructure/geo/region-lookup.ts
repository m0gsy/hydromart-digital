import { readFileSync } from 'fs';
import { join } from 'path';

import { Inject, Injectable, Optional } from '@nestjs/common';
import { LatLng, pointInServiceArea } from '@hydromart/platform';

import { RegionCodes, RegionHit, regionCodesFor } from '../../domain/region-codes';

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
  private asset: RegionAsset | null;
  private byParent: Map<string, RegionFeature[]> | null = null;

  // The token is never provided in the app (the file is read on first use); tests pass an asset.
  constructor(@Optional() @Inject('REGION_ASSET') asset?: RegionAsset) {
    this.asset = asset ?? null;
  }

  private load(): RegionAsset & { byParent: Map<string, RegionFeature[]> } {
    this.asset ??= JSON.parse(
      readFileSync(join(__dirname, 'regions.json'), 'utf8'),
    ) as RegionAsset;
    if (!this.byParent) {
      this.byParent = new Map();
      for (const f of this.asset.adm4) {
        const list = this.byParent.get(f.p!) ?? [];
        list.push(f);
        this.byParent.set(f.p!, list);
      }
    }
    return { ...this.asset, byParent: this.byParent };
  }

  find(lat: number, lng: number): RegionHit | null {
    const { adm3, byParent } = this.load();
    const point = { lat, lng };
    const kec = adm3.find((f) => inFeature(point, f));
    if (!kec) return null;
    const kel = (byParent.get(kec.c) ?? []).find((f) => inFeature(point, f));
    return {
      kecamatan: { code: kec.c, name: kec.n },
      kelurahan: kel ? { code: kel.c, name: kel.n } : null,
    };
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
