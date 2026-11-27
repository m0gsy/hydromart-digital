import type {
  B2bCategory,
  B2bDncReason,
  B2bProspectStatus,
  B2bSource,
  DuplicateProbe,
  NewProspect,
  ProspectRecord,
} from '../../domain/b2b-prospect';

export interface ProspectListQuery {
  /** `work` = rows with an owner depot; `map` = the opportunity map (no owner depot). */
  scope: 'work' | 'map';
  /** Owner-depot filter for `work`; `undefined` = network role, no filter. */
  depotIds?: readonly string[];
  status?: B2bProspectStatus;
  category?: B2bCategory;
  kecamatanCode?: string;
  kelurahanCode?: string;
  assignedToId?: string;
  unassigned?: boolean;
  /** Matches the business name only. */
  q?: string;
  cursor?: string;
  limit: number;
}

/** The keyed hashes of one prospect's do-not-contact entries (phone, and the name+cell neighbourhood). */
export interface DncKeys {
  phoneHash: string | null;
  placeHashes: readonly string[];
}

export type CreateOutcome =
  | { ok: true; prospect: ProspectRecord }
  | { ok: false; reason: 'DUPLICATE' | 'DO_NOT_CONTACT' };

export interface ProspectPatch {
  status?: B2bProspectStatus;
  lostReason?: string | null;
  assignedToId?: string | null;
  assignedAt?: Date | null;
  ownerDepotId?: string | null;
  ownerSource?: 'AUTO' | 'HQ';
  lastActivityAt: Date;
}

export interface CoverageRaw {
  total: number;
  onMap: number;
  byCategory: { category: B2bCategory; total: number; withPhone: number }[];
  byStatus: { status: B2bProspectStatus; total: number }[];
  bySource: { source: B2bSource; total: number }[];
  /** Epoch ms of the newest / median / oldest `coalesce(sourceDate, createdAt)`; null when no rows. */
  age: { newest: number; median: number; oldest: number } | null;
  /** Sum of the import batches' cost; null unless asked (network roles only). */
  thirdPartyCostIdr: number | null;
}

export interface B2bProspectRepository {
  findById(id: string): Promise<ProspectRecord | null>;
  list(q: ProspectListQuery): Promise<{ items: ProspectRecord[]; nextCursor: string | null }>;
  /** Latest check-ins of one prospect (AREA-1b fills the table; the detail route reads it). */
  visits(prospectId: string, take: number): Promise<VisitRecord[]>;

  /** Rows that could be the same business as the probe (same dataset id, phone, or name in a box around the pin). */
  findDuplicateCandidates(probe: DuplicateProbe): Promise<DuplicateProbe[]>;
  dncPresent(keys: DncKeys): Promise<boolean>;

  /**
   * Re-checks do-not-contact and duplicates and inserts, all under one advisory lock so two
   * parallel creates cannot both pass. A unique violation is a DUPLICATE, not a 500.
   * ponytail: one global lock, fine at <= 500 rows per file; a per-kecamatan lock if imports ever run in parallel.
   */
  createGuarded(data: NewProspect, dnc: DncKeys): Promise<CreateOutcome>;

  /** Optimistic: with `seenUpdatedAt` the write only lands on the row version the caller read. Null = stale/gone. */
  update(id: string, patch: ProspectPatch, seenUpdatedAt?: Date): Promise<ProspectRecord | null>;

  /** Idempotent: an entry already on the list is left alone. */
  addDnc(entries: { kind: 'PHONE' | 'PLACE'; keyHash: string }[], reason: B2bDncReason, addedById: string): Promise<void>;
  /**
   * One transaction: the do-not-contact entries, then every live prospect matching the phone or
   * the place becomes DO_NOT_CONTACT with phone, contact, note and address wiped (name, pin and
   * category stay: coverage and duplicate matching need them). Returns how many rows changed.
   */
  suppress(
    match: { id?: string; phoneE164?: string | null; nameKey?: string; cells?: readonly string[] },
    entries: { kind: 'PHONE' | 'PLACE'; keyHash: string }[],
    reason: B2bDncReason,
    addedById: string,
    now: Date,
  ): Promise<number>;

  createBatch(data: {
    id: string;
    sources: string;
    licences: string;
    rows: number;
    created: number;
    refused: number;
    failed: number;
    costIdr: number;
    importedById: string;
  }): Promise<void>;

  coverage(scope: { depotIds?: readonly string[]; includeCost: boolean }): Promise<CoverageRaw>;
}

export interface VisitRecord {
  id: string;
  visitorId: string;
  latitude: number;
  longitude: number;
  accuracyM: number;
  distanceM: number;
  outcome: string;
  note: string | null;
  visitedAt: Date;
}
