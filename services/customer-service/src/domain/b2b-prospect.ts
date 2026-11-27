/**
 * B2B prospects: businesses (kos, schools, clinics...) a depot could sell gallons to. Not the
 * calon-mitra (franchise applicant) CRM. Pure types and tables; no I/O.
 */

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

export type B2bSource = 'OVERTURE' | 'OSM' | 'FOURSQUARE_OS' | 'INTERNAL' | 'FIELD';
export type B2bOwnerSource = 'AUTO' | 'HQ';
export const DNC_REASONS = [
  'PROSPECT_REFUSED',
  'CUSTOMER_REQUEST',
  'WRONG_NUMBER',
  'LEGAL',
  'OTHER',
] as const;
export type B2bDncReason = (typeof DNC_REASONS)[number];

/** The four ways intake says no (the import summary counts each). */
export const REFUSAL_REASONS = ['LICENCE', 'DO_NOT_CONTACT', 'ALREADY_CUSTOMER', 'DUPLICATE'] as const;
export type RefusalReason = (typeof REFUSAL_REASONS)[number];

/** Hard ceiling per import file; AREA-T never writes more than this per part. */
export const IMPORT_MAX_ROWS = 500;

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

/** The `source` column values an import file may carry. FIELD is the server's, never a file's. */
export const IMPORT_SOURCES: Readonly<Record<string, B2bSource>> = {
  overture: 'OVERTURE',
  osm: 'OSM',
  foursquare_os: 'FOURSQUARE_OS',
  internal: 'INTERNAL',
};

/**
 * Which licence ids each open source may carry (AREA-T allow-list; legal confirms before the
 * first real import). INTERNAL and FIELD are our own data: no licence needed.
 * ponytail: CC0-1.0 is left out on purpose, AREA-T excludes AllThePlaces by default.
 */
export const ACCEPTED_LICENCES: Readonly<Partial<Record<B2bSource, readonly string[]>>> = {
  OVERTURE: ['CDLA-Permissive-2.0', 'Apache-2.0'],
  OSM: ['ODbL-1.0'],
  FOURSQUARE_OS: ['Apache-2.0'],
};

const ALL_ACCEPTED = new Set(Object.values(ACCEPTED_LICENCES).flat());

/**
 * AREA-T joins the licence of every record that contributed a field with `;` (a phone from OSM on
 * an Overture row: `CDLA-Permissive-2.0;ODbL-1.0`). Every token must be a licence we accept, and
 * the primary source's own licence must be among them. Missing, `google*`, `scrape*`: refused.
 */
export function licenceAccepted(source: B2bSource, licence: string | null | undefined): boolean {
  const own = ACCEPTED_LICENCES[source];
  if (!own) return true;
  const tokens = (licence ?? '')
    .split(';')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  return tokens.length > 0 && tokens.every((t) => ALL_ACCEPTED.has(t)) && tokens.some((t) => own.includes(t));
}

/** A stored prospect, as the repository returns it. */
export interface ProspectRecord {
  id: string;
  name: string;
  nameKey: string;
  category: B2bCategory;
  phoneE164: string | null;
  contactName: string | null;
  address: string | null;
  latitude: number;
  longitude: number;
  gridCell: string;
  kecamatanCode: string | null;
  kelurahanCode: string | null;
  ownerDepotId: string | null;
  ownerSource: B2bOwnerSource;
  status: B2bProspectStatus;
  assignedToId: string | null;
  assignedAt: Date | null;
  source: B2bSource;
  licence: string | null;
  sourceId: string | null;
  sourceDataset: string | null;
  sourceDate: Date | null;
  batchId: string | null;
  customerId: string | null;
  convertedAt: Date | null;
  lostReason: string | null;
  note: string | null;
  lastActivityAt: Date;
  /** When a do-not-contact wipe emptied the row: its own purge clock. Null on every other row. */
  suppressedAt: Date | null;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** What a create writes; everything else takes its default (status NEW, ownerSource AUTO). */
export type NewProspect = Pick<
  ProspectRecord,
  | 'name'
  | 'nameKey'
  | 'category'
  | 'phoneE164'
  | 'contactName'
  | 'address'
  | 'latitude'
  | 'longitude'
  | 'gridCell'
  | 'kecamatanCode'
  | 'kelurahanCode'
  | 'ownerDepotId'
  | 'source'
  | 'licence'
  | 'sourceId'
  | 'sourceDataset'
  | 'sourceDate'
  | 'batchId'
  | 'note'
  | 'createdById'
>;

/** What a duplicate match compares (also what the in-file dry-run seen-set holds). */
export interface DuplicateProbe {
  source: B2bSource;
  sourceId: string | null;
  phoneE164: string | null;
  nameKey: string;
  latitude: number;
  longitude: number;
}

/** Two businesses with the same name key closer than this are the same business. */
export const DUPLICATE_RADIUS_M = 150;
