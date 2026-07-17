import { SettlementStatus } from '../../domain/settlement';

export interface SettlementRecord {
  id: string;
  shiftId: string;
  driverId: string;
  depotId: string;
  status: SettlementStatus;
  orderIds: string[];
  expectedAmount: number;
  depositedAmount: number;
  variance: number;
  chargedToDriver: boolean;
  note: string | null;
  verifiedBy: string | null;
  verifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateSettlementData {
  shiftId: string;
  driverId: string;
  depotId: string;
  orderIds: string[];
  expectedAmount: number;
  depositedAmount: number;
  variance: number;
}

/** Fields a cashier's ruling writes. */
export interface ResolveSettlementPatch {
  status: SettlementStatus;
  chargedToDriver: boolean;
  note: string | null;
  verifiedBy: string;
  verifiedAt: Date;
}

export interface SettlementQuery {
  depotId: string;
  status?: SettlementStatus;
}

export interface SettlementRepository {
  create(data: CreateSettlementData): Promise<SettlementRecord>;
  findById(id: string): Promise<SettlementRecord | null>;
  findByShift(shiftId: string): Promise<SettlementRecord | null>;
  /** A courier's settlement history, newest first. */
  listByDriver(driverId: string, limit: number): Promise<SettlementRecord[]>;
  /** Cashier queue: settlements at a depot, optionally filtered by status. */
  search(query: SettlementQuery): Promise<SettlementRecord[]>;
  resolve(id: string, patch: ResolveSettlementPatch): Promise<SettlementRecord>;
}
