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
  /** The reason typed with the latest review/block/clear decision, if one was given. */
  decisionReason: string | null;
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
  /** Insert a flag (internal-key ingest from a scoring job). FraudFlagAlreadyOpenError when one is open. */
  create(data: CreateFraudFlagData): Promise<FraudFlagRecord>;
  /**
   * CA-2-05: read one flag, because blocking now depends on WHAT it points at.
   *
   * An ACCOUNT flag suspends the account behind it; an ORDER flag cannot. The decision
   * needs the row before the write, which `setStatus` alone could not give.
   */
  findById(id: string): Promise<FraudFlagRecord | null>;
  /**
   * Clears a flag and decides, in the SAME locked step, whether the account it suspended
   * should now be reinstated. `countBlockedFor` then `setStatus` as two calls let two
   * flags on one account be cleared at once, each seeing the other still BLOCKED, so neither
   * reinstated. Null when the id is unknown. `previous` lets the caller put the status back
   * if reinstating the account then fails.
   */
  clear(
    id: string,
    reason: string | null,
  ): Promise<{ flag: FraudFlagRecord; previous: FraudStatus; reinstate: boolean } | null>;
  /**
   * Set a flag's review status. Null when the id is unknown.
   *
   * ADM-8: `blockedAt` is stamped when the status becomes BLOCKED and never cleared —
   * "this flag suspended somebody" is a fact about what happened, not a current state.
   */
  setStatus(
    id: string,
    status: FraudStatus,
    reason?: string | null,
  ): Promise<FraudFlagRecord | null>;
  /**
   * ADM-8: how many OTHER flags still hold this entity blocked.
   *
   * Clearing one flag used to reinstate the account outright, so an account held by two
   * separate suspicions was released by resolving either of them — the remaining flag stayed
   * BLOCKED on the screen while the customer ordered again.
   */
  countBlockedFor(entityRef: string, excludeId: string): Promise<number>;
}
