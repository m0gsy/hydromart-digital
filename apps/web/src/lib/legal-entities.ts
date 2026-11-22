// HD-5 — the shapes /hq/legal-entities reads (depot-service + hr-service), and the one rule
// both histories share: a point holds from its day until the next point starts.

export type LegalEntityKind = 'FRANCHISOR' | 'OPERATOR' | 'FRANCHISEE';

export const LEGAL_ENTITY_KINDS: readonly LegalEntityKind[] = ['FRANCHISOR', 'OPERATOR', 'FRANCHISEE'];

export interface LegalEntity {
  id: string;
  name: string;
  kind: LegalEntityKind;
  active: boolean;
  updatedAt: string;
  /** Roles that may read this entity's data in the AI web. */
  aiReadRoles: string[];
}

/** A row of the AI-web matrix. `name` = a super admin's rename or a custom role's own name. */
export interface AiGrantableRole {
  key: string;
  name: string | null;
  custom: boolean;
}

export interface LegalEntityDirectory {
  entities: LegalEntity[];
  roles: AiGrantableRole[];
}

/** From `effectiveFrom` (`YYYY-MM-DD`) the depot or employee belongs to the entity. */
export interface LegalEntityPoint {
  id: string;
  legalEntityId: string;
  effectiveFrom: string;
}

export interface DepotLegalEntityHistory {
  depotId: string;
  code: string;
  name: string;
  ownershipType: string;
  active: boolean;
  /** Newest first. */
  points: LegalEntityPoint[];
}

export interface EmployeeLegalEntityHistory {
  employeeId: string;
  employeeCode: string;
  fullName: string;
  position: string;
  depotId: string | null;
  status: string;
  /** Newest first. */
  points: LegalEntityPoint[];
}

/** The point in force on `day`: the newest one that has started. Points come newest first. */
export function pointOn(points: readonly LegalEntityPoint[], day: string): LegalEntityPoint | null {
  return points.find((p) => p.effectiveFrom <= day) ?? null;
}

/** The next change after `day`, if one is already dated: the earliest point still to start. */
export function nextPoint(points: readonly LegalEntityPoint[], day: string): LegalEntityPoint | null {
  return points.filter((p) => p.effectiveFrom > day).at(-1) ?? null;
}
