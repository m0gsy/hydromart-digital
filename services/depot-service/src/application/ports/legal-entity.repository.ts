import {
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
}

/** A depot whose point on that day was written: `replaced` = the entity it had there before, if any. */
export interface AssignedDepot {
  depotId: string;
  replaced: string | null;
}

export interface LegalEntityRepository {
  /** Every legal entity, by name, with the roles granted on it. */
  list(): Promise<LegalEntityRecord[]>;
  findById(id: string): Promise<LegalEntity | null>;
  /** The ones of these ids that exist. */
  existingIds(ids: string[]): Promise<string[]>;
  /** Throws DuplicateLegalEntityNameError when another entity has the name (ignoring case). */
  create(data: CreateLegalEntityData): Promise<LegalEntity>;
  /** Same refusal as `create` for a rename onto another entity's name. */
  update(id: string, data: UpdateLegalEntityData): Promise<LegalEntity>;
  /** Every change in one transaction; granting what is granted and revoking what is not are no-ops. */
  setAiGrants(changes: AiGrantChange[], grantedBy: string | null): Promise<void>;
  /** Every depot, by code, with its change points newest first. */
  depotHistories(): Promise<DepotLegalEntityHistory[]>;
  /**
   * One change point per depot on that day, in one statement: a new day is a new point, an
   * existing day is corrected in place. Returns only the depots whose row was written, so a
   * depot already holding this entity on that day is left alone and absent from the result.
   */
  assignDepots(data: AssignDepotsData): Promise<AssignedDepot[]>;
  /** Deletes one change point and returns it, or null when there is none with that id. */
  removeDepotPoint(id: string): Promise<DepotLegalEntityPoint | null>;
}
