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
  /** Set a flag's review status. Null when the id is unknown. */
  setStatus(id: string, status: FraudStatus): Promise<FraudFlagRecord | null>;
}
