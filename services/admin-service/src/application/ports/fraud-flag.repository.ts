import { FraudEntityType, FraudLevel, FraudStatus } from '../../domain/fraud';

export interface FraudFlagRecord {
  id: string;
  entityType: FraudEntityType;
  entityRef: string;
  score: number;
  level: FraudLevel;
  signals: string[];
  status: FraudStatus;
  /** ADM-8: when this flag suspended the account, or null if it never did. */
  blockedAt: Date | null;
  createdAt: Date;
}

export interface CreateFraudFlagData {
  entityType: FraudEntityType;
  entityRef: string;
  score: number;
  level: FraudLevel;
  signals: string[];
  status?: FraudStatus;
}

export interface ListFraudFlagsFilter {
  level?: FraudLevel;
  status?: FraudStatus;
}

export interface FraudFlagRepository {
  /** Flags ordered highest-score-then-newest first, optionally filtered. */
  list(filter: ListFraudFlagsFilter): Promise<FraudFlagRecord[]>;
  /** Insert a flag (internal-key ingest from a scoring job). */
  create(data: CreateFraudFlagData): Promise<FraudFlagRecord>;
  /**
   * CA-2-05: read one flag, because blocking now depends on WHAT it points at.
   *
   * An ACCOUNT flag suspends the account behind it; an ORDER flag cannot. The decision
   * needs the row before the write, which `setStatus` alone could not give.
   */
  findById(id: string): Promise<FraudFlagRecord | null>;
  /**
   * Set a flag's review status. Null when the id is unknown.
   *
   * ADM-8: `blockedAt` is stamped when the status becomes BLOCKED and never cleared —
   * "this flag suspended somebody" is a fact about what happened, not a current state.
   */
  setStatus(id: string, status: FraudStatus): Promise<FraudFlagRecord | null>;
  /**
   * ADM-8: how many OTHER flags still hold this entity blocked.
   *
   * Clearing one flag used to reinstate the account outright, so an account held by two
   * separate suspicions was released by resolving either of them — the remaining flag stayed
   * BLOCKED on the screen while the customer ordered again.
   */
  countBlockedFor(entityRef: string, excludeId: string): Promise<number>;
}
