/** The ids are the AREA-T contract (scripts/area/data/categories.json), upper-cased. */
export const B2B_CATEGORIES = [
  'KOS',
  'SEKOLAH',
  'PESANTREN',
  'TEMPAT_IBADAH',
  'KLINIK',
  'BENGKEL',
  'SALON',
  'KEBUGARAN',
  'RUMAH_MAKAN',
  'KANTOR_RUKO',
  'LAUNDRY',
  'PENGINAPAN',
  'PABRIK_GUDANG',
] as const;
export type B2bCategory = (typeof B2B_CATEGORIES)[number];

export const B2B_STATUSES = [
  'NEW',
  'CONTACTED',
  'VISITED',
  'INTERESTED',
  'CONVERTED',
  'LOST',
  'DO_NOT_CONTACT',
] as const;
export type B2bProspectStatus = (typeof B2B_STATUSES)[number];

/**
 * The candidate-file columns, in order: the AREA-T contract (spec-areat.md 3.8). The web import
 * wizard and AREA-T's writer read this same list; a unit test holds its order. Some are
 * informational only (the server recomputes region codes, grid cell and owner depot itself).
 */
export const IMPORT_COLUMNS = [
  'name',
  'category',
  'address',
  'phone',
  'lat',
  'lng',
  'kecamatanCode',
  'kelurahanCode',
  'gridCell',
  'ownerDepotCode',
  'distanceKm',
  'source',
  'license',
  'sourceId',
  'sourceDataset',
  'sourceUpdated',
  'fetchedDate',
  'categoryConfidence',
  'alsoIn',
] as const;
