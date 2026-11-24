import {
  DepotEntitySpan,
  DepotLegalEntityHistory,
  DepotLegalEntityPoint,
  LegalEntity,
  LegalEntityKind,
  LegalEntityRecord,
} from '../../domain/legal-entity';

export interface CreateLegalEntityData {
  name: string;
  kind: LegalEntityKind;
  createdBy: string | null;
}

/** Absent = unchanged. */
export interface UpdateLegalEntityData {
  name?: string;
  kind?: LegalEntityKind;
  active?: boolean;
  updatedBy: string | null;
}

/** One cell of the role x legal entity matrix, as the caller wants it to be. */
export interface AiGrantChange {
  legalEntityId: string;
  roleKey: string;
  granted: boolean;
}

export interface AssignDepotsData {
  depotIds: string[];
  legalEntityId: string;
  /** UTC midnight of the calendar day (a `@db.Date`). */
  effectiveFrom: Date;
  recordedBy: string | null;
  /**
   * What the screen showed on that day: depot id -> entity, for every depot that had a point there.
   * A depot not in it was shown with none. The write is refused when the stored day differs.
   */
  seen: ReadonlyMap<string, string>;
}

/** A depot whose point on that day was written: `replaced` = the entity it had there before, if any. */
export interface AssignedDepot {
  depotId: string;
  replaced: string | null;
}

export interface LegalEntityRepository {
  /** HD-6: the depots' legal entity over `[from, to]` (calendar days, UTC midnight), see `entitySpans`. */
  entityTimeline(depotIds: string[], from: Date, to: Date): Promise<DepotEntitySpan[]>;
  /** HD-6: the legal entities this role key is granted in the AI web (no row = not granted). */
  grantedEntityIds(roleKey: string): Promise<string[]>;
  /** Every legal entity, by name, with the roles granted on it. */
  list(): Promise<LegalEntityRecord[]>;
  findById(id: string): Promise<LegalEntity | null>;
  /** The ones of these ids that exist. */
  existingIds(ids: string[]): Promise<string[]>;
  /** Throws DuplicateLegalEntityNameError when another entity has the name (ignoring case). */
  create(data: CreateLegalEntityData): Promise<LegalEntity>;
  /**
   * Same refusal as `create` for a rename onto another entity's name. Compare-and-set on
   * `expectedUpdatedAt` (the version the caller checked): StaleWriteError when it moved since.
   * Null = no version to compare (a bare on/off decision).
   */
  update(id: string, data: UpdateLegalEntityData, expectedUpdatedAt: Date | null): Promise<LegalEntity>;
  /** Every change in one transaction; granting what is granted and revoking what is not are no-ops. */
  setAiGrants(changes: AiGrantChange[], grantedBy: string | null): Promise<void>;
  /** Every depot, by code, with its change points newest first. */
  depotHistories(): Promise<DepotLegalEntityHistory[]>;
  /**
   * One change point per depot on that day: a new day is a new point, an existing day is
   * corrected in place. Each (depot, day) is locked first, and the write is refused with
   * StaleWriteError when a day no longer holds what `seen` says the screen showed. Returns only
   * the depots whose row was written: a depot already holding this entity that day is left alone.
   */
  assignDepots(data: AssignDepotsData): Promise<AssignedDepot[]>;
  /**
   * Deletes one change point if it still holds `seenLegalEntityId` and returns it; null when there
   * is none with that id; StaleWriteError when it exists but was corrected to another entity.
   */
  removeDepotPoint(id: string, seenLegalEntityId: string): Promise<DepotLegalEntityPoint | null>;
}
