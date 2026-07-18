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

/** One courier's charged COD shortfall total at a depot in a window (design 11c). */
export interface CourierShortfall {
  driverId: string;
  shortfallIdr: number;
}

export interface SettlementRepository {
  create(data: CreateSettlementData): Promise<SettlementRecord>;
  findById(id: string): Promise<SettlementRecord | null>;
  findByShift(shiftId: string): Promise<SettlementRecord | null>;
  /** A courier's settlement history, newest first. */
  listByDriver(driverId: string, limit: number): Promise<SettlementRecord[]>;
  /** Cashier queue: settlements at a depot, optionally filtered by status. */
  search(query: SettlementQuery): Promise<SettlementRecord[]>;
  /**
   * Charged COD shortfalls per courier at `depotId` whose settlement was created in
   * [from, to) — the amount to deduct from that courier's commission (design 11c). Only
   * settlements with chargedToDriver=true (a genuine, cashier-accepted shortfall) count.
   */
  chargedShortfallByDriver(depotId: string, from: Date, to: Date): Promise<CourierShortfall[]>;
  resolve(id: string, patch: ResolveSettlementPatch): Promise<SettlementRecord>;
}
