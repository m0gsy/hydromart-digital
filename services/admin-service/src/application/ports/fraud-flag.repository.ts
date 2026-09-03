import { FraudEntityType, FraudLevel, FraudStatus } from '../../domain/fraud';

export interface FraudFlagRecord {
  id: string;
  entityType: FraudEntityType;
  entityRef: string;
  score: number;
  level: FraudLevel;
  signals: string[];
  status: FraudStatus;
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
  /** Set a flag's review status. Null when the id is unknown. */
  setStatus(id: string, status: FraudStatus): Promise<FraudFlagRecord | null>;
}
