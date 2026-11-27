import {
  ACCEPTED_LICENCES,
  B2B_CATEGORIES,
  B2B_STATUSES,
  IMPORT_COLUMNS,
  IMPORT_SOURCES,
  licenceAccepted,
} from '../../src/domain/b2b-prospect';
import { dncHash, matchDuplicate, neighbourCells, normaliseName, placeKeys } from '../../src/domain/b2b-prospect-keys';
import { canSetByHand, canTransition, isTerminal } from '../../src/domain/b2b-prospect-status';
import { inReach, reachOf } from '../../src/domain/prospect-reach';
import { loadCustomRoles, loadOverrides } from '@hydromart/access';
import { Role } from '@hydromart/platform';

describe('import contract (AREA-T spec-areat.md 3.8)', () => {
  it('holds the candidate-file columns in order', () => {
    expect([...IMPORT_COLUMNS]).toEqual([
      'name', 'category', 'address', 'phone', 'lat', 'lng', 'kecamatanCode', 'kelurahanCode', 'gridCell',
      'ownerDepotCode', 'distanceKm', 'source', 'license', 'sourceId', 'sourceDataset', 'sourceUpdated',
      'fetchedDate', 'categoryConfidence', 'alsoIn',
    ]);
  });

  it('holds the 13 AREA-T category ids and the accepted import sources', () => {
    expect(B2B_CATEGORIES).toHaveLength(13);
    expect(B2B_CATEGORIES).toEqual(expect.arrayContaining(['KEBUGARAN', 'KANTOR_RUKO', 'PABRIK_GUDANG']));
    expect(Object.keys(IMPORT_SOURCES)).toEqual(['overture', 'osm', 'foursquare_os', 'internal']);
  });
});

describe('licenceAccepted', () => {
  it.each([
    ['OVERTURE', 'CDLA-Permissive-2.0', true],
    ['OVERTURE', 'Apache-2.0', true],
    ['OVERTURE', 'CDLA-Permissive-2.0;ODbL-1.0', true],
    ['OVERTURE', ' CDLA-Permissive-2.0 ; Apache-2.0 ', true],
    ['OSM', 'ODbL-1.0', true],
    ['FOURSQUARE_OS', 'Apache-2.0', true],
    ['OVERTURE', 'CC0-1.0', false],
    ['OVERTURE', 'google-maps', false],
    ['OVERTURE', 'scrape', false],
    ['OVERTURE', 'CDLA-Permissive-2.0;google', false],
    ['OVERTURE', '', false],
    ['OVERTURE', null, false],
    ['OSM', 'Apache-2.0', false],
    ['OSM', ';', false],
    ['INTERNAL', null, true],
    ['FIELD', undefined, true],
  ] as const)('%s with %p -> %s', (source, licence, ok) => {
    expect(licenceAccepted(source, licence)).toBe(ok);
  });

  it('lists a licence set per open source only', () => {
    expect(Object.keys(ACCEPTED_LICENCES)).toEqual(['OVERTURE', 'OSM', 'FOURSQUARE_OS']);
  });
});

describe('status machine', () => {
  const allowed: Record<string, string[]> = {
    NEW: ['CONTACTED', 'VISITED', 'LOST'],
    CONTACTED: ['VISITED', 'INTERESTED', 'LOST'],
    VISITED: ['CONTACTED', 'INTERESTED', 'LOST'],
    INTERESTED: ['VISITED', 'LOST'],
    LOST: ['NEW'],
    CONVERTED: [],
    DO_NOT_CONTACT: [],
  };

  it('answers every one of the 49 pairs', () => {
    let pairs = 0;
    for (const from of B2B_STATUSES) {
      for (const to of B2B_STATUSES) {
        pairs += 1;
        expect(canTransition(from, to)).toBe(allowed[from]!.includes(to));
      }
    }
    expect(pairs).toBe(49);
  });

  it('never sets CONVERTED or DO_NOT_CONTACT by hand, and NEW to VISITED only by check-in', () => {
    for (const from of B2B_STATUSES) {
      expect(canSetByHand(from, 'CONVERTED')).toBe(false);
      expect(canSetByHand(from, 'DO_NOT_CONTACT')).toBe(false);
    }
    expect(canSetByHand('NEW', 'VISITED')).toBe(false);
    expect(canSetByHand('CONTACTED', 'VISITED')).toBe(true);
  });

  it('knows which states are terminal', () => {
    expect(B2B_STATUSES.filter(isTerminal)).toEqual(['CONVERTED', 'DO_NOT_CONTACT']);
  });
});

describe('keys', () => {
  it('normalises a name: case, accents, punctuation and a leading business-type word', () => {
    expect(normaliseName('PT. Berkah  Jaya')).toBe('berkahjaya');
    expect(normaliseName('Warung Ibu Éni')).toBe('ibueni');
    expect(normaliseName('Toko Maju')).toBe('maju');
    expect(normaliseName('CV UD Maju')).toBe('maju');
    expect(normaliseName('Kos-Kosan Melati 2')).toBe('koskosanmelati2');
    expect(normaliseName('PT')).toBe('pt');
    expect(normaliseName('')).toBe('');
    expect(normaliseName('!!!')).toBe('');
  });

  it('hashes with HMAC: stable, keyed, and kind-separated', () => {
    const a = dncHash('k'.repeat(32), 'PHONE', '+6281200000001');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(dncHash('k'.repeat(32), 'PHONE', '+6281200000001')).toBe(a);
    expect(dncHash('j'.repeat(32), 'PHONE', '+6281200000001')).not.toBe(a);
    expect(dncHash('k'.repeat(32), 'PLACE', '+6281200000001')).not.toBe(a);
    expect(a).not.toContain('6281200000001');
  });

  it('lists the cell and its eight neighbours, negative cells included', () => {
    const cells = neighbourCells('-687:11869');
    expect(cells).toHaveLength(9);
    expect(cells).toEqual(expect.arrayContaining(['-687:11869', '-688:11868', '-686:11870']));
    expect(neighbourCells('0:0')).toEqual(expect.arrayContaining(['-1:-1', '1:1', '0:0']));
    expect(placeKeys('maju', '1:2')).toContain('maju|2:3');
  });

  it('matches duplicates by dataset id, phone, and same name within 150 m only', () => {
    const base = { source: 'OSM', sourceId: 'node/1', phoneE164: '+6281200000001', nameKey: 'maju', latitude: -6.2, longitude: 106.8 } as const;
    expect(matchDuplicate([base], { ...base, phoneE164: null })).toBe('SOURCE_ID');
    expect(matchDuplicate([base], { ...base, sourceId: 'node/2' })).toBe('PHONE');
    const near = { ...base, sourceId: null, phoneE164: null, latitude: -6.2005 };
    expect(matchDuplicate([base], near)).toBe('NAME_NEAR');
    expect(matchDuplicate([base], { ...near, latitude: -6.205 })).toBeNull();
    expect(matchDuplicate([base], { ...near, nameKey: 'lain' })).toBeNull();
    expect(matchDuplicate([], base)).toBeNull();
    // the same id from ANOTHER dataset is not the same row
    expect(matchDuplicate([base], { ...base, source: 'OVERTURE', phoneE164: null, nameKey: 'lain' })).toBeNull();
  });
});

describe('reach rule', () => {
  const sales = { sub: 'sales-1', role: 'C_sales', depotId: 'depot-a', depotIds: ['depot-a'] };
  const kepala = { sub: 'kepala-1', role: Role.KEPALA_DEPOT, depotId: 'depot-a', depotIds: ['depot-a'] };
  const marketing = { sub: 'm-1', role: Role.MARKETING, depotId: null, depotIds: undefined };

  beforeAll(() => {
    loadCustomRoles([{ key: 'C_sales', name: 'Sales Depot', scope: 'LOCKED' }]);
    loadOverrides({ b2bProspectWork: ['C_sales'] });
  });
  afterAll(() => {
    loadOverrides({});
    loadCustomRoles([]);
  });

  it('a Sales-only role sees only its own assigned rows inside its depot', () => {
    const reach = reachOf(sales as never);
    expect(reach.assignedOnly).toBe(true);
    expect(inReach(reach, sales, { ownerDepotId: 'depot-a', assignedToId: 'sales-1' })).toBe(true);
    expect(inReach(reach, sales, { ownerDepotId: 'depot-a', assignedToId: 'someone-else' })).toBe(false);
    expect(inReach(reach, sales, { ownerDepotId: 'depot-a', assignedToId: null })).toBe(false);
    expect(inReach(reach, sales, { ownerDepotId: 'depot-b', assignedToId: 'sales-1' })).toBe(false);
  });

  it('Manage sees the whole depot scope, and a Kepala of depot B gets nothing of depot A', () => {
    const reach = reachOf(kepala as never);
    expect(reach.assignedOnly).toBe(false);
    expect(inReach(reach, kepala, { ownerDepotId: 'depot-a', assignedToId: null })).toBe(true);
    const other = { ...kepala, depotId: 'depot-b', depotIds: ['depot-b'] };
    expect(inReach(reachOf(other as never), other, { ownerDepotId: 'depot-a', assignedToId: null })).toBe(false);
  });

  it('a network role reaches every owned row, and nobody reaches an opportunity-map row', () => {
    const reach = reachOf(marketing as never);
    expect(reach.depotIds).toBeUndefined();
    expect(inReach(reach, marketing, { ownerDepotId: 'depot-z', assignedToId: null })).toBe(true);
    expect(inReach(reach, marketing, { ownerDepotId: null, assignedToId: null })).toBe(false);
    expect(inReach(reachOf(kepala as never), kepala, { ownerDepotId: null, assignedToId: null })).toBe(false);
  });
});
