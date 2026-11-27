import { B2B_CATEGORIES, B2B_STATUSES, IMPORT_COLUMNS } from './index';

describe('B2B prospect contract constants (AREA-T spec 3.8)', () => {
  it('holds the 19 candidate-file columns in order', () => {
    expect([...IMPORT_COLUMNS]).toEqual([
      'name', 'category', 'address', 'phone', 'lat', 'lng', 'kecamatanCode', 'kelurahanCode', 'gridCell',
      'ownerDepotCode', 'distanceKm', 'source', 'license', 'sourceId', 'sourceDataset', 'sourceUpdated',
      'fetchedDate', 'categoryConfidence', 'alsoIn',
    ]);
  });

  it('holds the 13 category ids and the 7 statuses', () => {
    expect(B2B_CATEGORIES).toHaveLength(13);
    expect(B2B_STATUSES).toEqual(['NEW', 'CONTACTED', 'VISITED', 'INTERESTED', 'CONVERTED', 'LOST', 'DO_NOT_CONTACT']);
  });
});
