import { randomUUID } from 'node:crypto';

import { ConfigService } from '@nestjs/config';

import { DeliveryConfigService } from '../../src/config/delivery-config.service';
import { DeliveryStatus, OrderFulfilmentStatus } from '../../src/domain/delivery-status';
import {
  CreateDeliveryData,
  DeliveredRow,
  DeliveryQuery,
  DeliveryRecord,
  DeliveryRepository,
  DeliveryTimestamps,
  DepotDeliveredCount,
  DepotSlaStats,
  ProofRecord,
  ReportRange,
  SlaStats,
} from '../../src/application/ports/delivery.repository';
import { ContactMethod, ContactState } from '../../src/domain/no-show';
import { OrderCoordinationPort } from '../../src/application/ports/order-coordination.port';
import { DepotLocation, DepotLocationPort } from '../../src/application/ports/depot-location.port';
import {
  OpenShiftData,
  ShiftQuery,
  ShiftRecord,
  ShiftRepository,
  ShiftStatusPatch,
} from '../../src/application/ports/shift.repository';
import { ShiftStatus } from '../../src/domain/shift';
import {
  CreateIncidentData,
  IncidentRecord,
  IncidentRepository,
} from '../../src/application/ports/incident.repository';
import { OpsIncidentAlert, OpsNotifierPort } from '../../src/application/ports/ops-notifier.port';
import { CashCollected, CashCollectionPort } from '../../src/application/ports/cash-collection.port';
import { RatingPort, RatingSummary } from '../../src/application/ports/rating.port';
import {
  CashVarianceChargedEvent,
  CourierPayoutPort,
  DeliveryCompletedEvent,
} from '../../src/application/ports/courier-payout.port';
import {
  CourierShortfall,
  CreateSettlementData,
  ResolveSettlementPatch,
  SettlementQuery,
  SettlementRecord,
  SettlementRepository,
} from '../../src/application/ports/settlement.repository';
import { SettlementStatus } from '../../src/domain/settlement';

let seq = 0;
const nextDate = (): Date => new Date(1_800_000_000_000 + (seq += 1) * 1000);

// Realm-safe deep clone. `structuredClone` is a Node builtin whose Dates carry the
// outer-realm Date prototype, so inside Jest's vm sandbox `toBeInstanceOf(Date)`
// fails ("Expected Date, Received Date"). Rebuilding Dates with the sandbox's own
// `new Date` keeps `instanceof` honest. ponytail: handles only Date/array/plain-object
// (all these records ever hold); widen if a Map/Set/etc. ever appears.
function clone<T>(value: T): T {
  if (value instanceof Date) return new Date(value.getTime()) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => clone(v)) as unknown as T;
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, clone(v)]),
    ) as T;
  }
  return value;
}

const ACTIVE: DeliveryStatus[] = [
  DeliveryStatus.ASSIGNED,
  DeliveryStatus.PICKED_UP,
  DeliveryStatus.ON_DELIVERY,
];

export class InMemoryDeliveryRepository implements DeliveryRepository {
  rows: DeliveryRecord[] = [];
  attempts: { deliveryId: string; driverId: string; method: ContactMethod; note: string | null; createdAt: Date }[] = [];

  async create(data: CreateDeliveryData): Promise<DeliveryRecord> {
    const now = nextDate();
    const rec: DeliveryRecord = {
      ...data,
      id: randomUUID(),
      status: DeliveryStatus.ASSIGNED,
      lastLat: null,
      lastLng: null,
      lastLocationAt: null,
      assignedAt: now,
      pickedUpAt: null,
      startedAt: null,
      deliveredAt: null,
      failedAt: null,
      failureReason: null,
      rescheduledFor: null,
      rescheduleSlot: null,
      rescheduleNote: null,
      proof: null,
      history: [{ status: DeliveryStatus.ASSIGNED, changedBy: null, note: null, createdAt: now }],
      createdAt: now,
      updatedAt: now,
    };
    this.rows.push(rec);
    return clone(rec);
  }
  async findById(id: string): Promise<DeliveryRecord | null> {
    const row = this.rows.find((r) => r.id === id);
    return row ? clone(row) : null;
  }
  async findByOrder(orderId: string): Promise<DeliveryRecord | null> {
    const row = this.rows.find((r) => r.orderId === orderId);
    return row ? clone(row) : null;
  }
  async countActiveByDriver(driverId: string): Promise<number> {
    return this.rows.filter((r) => r.driverId === driverId && ACTIVE.includes(r.status)).length;
  }
  async recordContactAttempt(
    deliveryId: string,
    driverId: string,
    method: ContactMethod,
    note: string | null,
  ): Promise<ContactState> {
    this.attempts.push({ deliveryId, driverId, method, note, createdAt: nextDate() });
    return this.contactState(deliveryId);
  }
  async contactState(deliveryId: string): Promise<ContactState> {
    const mine = this.attempts
      .filter((a) => a.deliveryId === deliveryId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    return { attempts: mine.length, firstAttemptAt: mine[0]?.createdAt ?? null };
  }
  async search(query: DeliveryQuery): Promise<{ items: DeliveryRecord[]; total: number }> {
    const all = this.rows
      .filter((r) => !query.driverId || r.driverId === query.driverId)
      .filter((r) => !query.depotId || r.depotId === query.depotId)
      .filter((r) => !query.status || r.status === query.status)
      .sort((a, b) => b.assignedAt.getTime() - a.assignedAt.getTime());
    const start = (query.page - 1) * query.limit;
    return {
      items: all.slice(start, start + query.limit).map((r) => clone(r)),
      total: all.length,
    };
  }
  async deliveredOrderIdsInWindow(driverId: string, from: Date, to: Date): Promise<string[]> {
    return this.rows
      .filter(
        (r) =>
          r.driverId === driverId &&
          r.status === DeliveryStatus.DELIVERED &&
          r.deliveredAt !== null &&
          r.deliveredAt.getTime() >= from.getTime() &&
          r.deliveredAt.getTime() <= to.getTime(),
      )
      .map((r) => r.orderId);
  }
  async driverDeliveredInWindow(
    driverId: string,
    from: Date,
    to: Date,
  ): Promise<DeliveredRow[]> {
    return this.rows
      .filter(
        (r) =>
          r.driverId === driverId &&
          r.status === DeliveryStatus.DELIVERED &&
          r.deliveredAt !== null &&
          r.deliveredAt.getTime() >= from.getTime() &&
          r.deliveredAt.getTime() < to.getTime(),
      )
      .map((r) => ({ orderId: r.orderId, assignedAt: r.assignedAt, deliveredAt: r.deliveredAt! }));
  }
  async driverFailedCountInWindow(driverId: string, from: Date, to: Date): Promise<number> {
    return this.rows.filter(
      (r) =>
        r.driverId === driverId &&
        r.failedAt !== null &&
        r.failedAt.getTime() >= from.getTime() &&
        r.failedAt.getTime() < to.getTime(),
    ).length;
  }
  async depotDeliveredCountsInWindow(
    depotId: string,
    from: Date,
    to: Date,
  ): Promise<DepotDeliveredCount[]> {
    const byDriver = new Map<string, number>();
    for (const r of this.rows) {
      if (
        r.depotId === depotId &&
        r.status === DeliveryStatus.DELIVERED &&
        r.deliveredAt !== null &&
        r.deliveredAt.getTime() >= from.getTime() &&
        r.deliveredAt.getTime() < to.getTime()
      ) {
        byDriver.set(r.driverId, (byDriver.get(r.driverId) ?? 0) + 1);
      }
    }
    return [...byDriver].map(([driverId, count]) => ({ driverId, count }));
  }
  async updateLocation(id: string, lat: number, lng: number): Promise<DeliveryRecord> {
    const row = this.rows.find((r) => r.id === id)!;
    Object.assign(row, { lastLat: lat, lastLng: lng, lastLocationAt: nextDate(), updatedAt: nextDate() });
    return clone(row);
  }
  async applyStatus(
    id: string,
    status: DeliveryStatus,
    timestamps: DeliveryTimestamps,
    changedBy: string | null,
    note: string | null,
  ): Promise<DeliveryRecord> {
    const row = this.rows.find((r) => r.id === id)!;
    Object.assign(row, timestamps, { status, updatedAt: nextDate() });
    row.history.push({ status, changedBy, note, createdAt: row.updatedAt });
    return clone(row);
  }
  async completeWithProof(
    id: string,
    proof: Omit<ProofRecord, 'capturedAt'>,
    changedBy: string,
  ): Promise<DeliveryRecord> {
    const row = this.rows.find((r) => r.id === id)!;
    const now = nextDate();
    row.status = DeliveryStatus.DELIVERED;
    row.deliveredAt = now;
    row.updatedAt = now;
    row.proof = { ...proof, capturedAt: now };
    row.history.push({ status: DeliveryStatus.DELIVERED, changedBy, note: null, createdAt: now });
    return clone(row);
  }
  async purgeProofsBefore(cutoff: Date): Promise<number> {
    let count = 0;
    for (const r of this.rows) {
      if (r.proof && r.proof.capturedAt.getTime() < cutoff.getTime()) {
        r.proof = null;
        count += 1;
      }
    }
    return count;
  }
  async slaStats(
    range: ReportRange,
    thresholdMinutes: number,
    depotIds?: string[],
  ): Promise<SlaStats> {
    const inRange = (d: Date): boolean =>
      (!range.from || d.getTime() >= range.from.getTime()) &&
      (!range.to || d.getTime() < range.to.getTime());
    const scoped = depotIds !== undefined && depotIds.length > 0;
    const inScope = (r: DeliveryRecord): boolean =>
      !scoped || (r.depotId !== null && depotIds!.includes(r.depotId));
    const delivered = this.rows.filter((r) => r.deliveredAt && inRange(r.deliveredAt) && inScope(r));
    let onTime = 0;
    let sumMinutes = 0;
    for (const r of delivered) {
      const minutes = (r.deliveredAt!.getTime() - r.assignedAt.getTime()) / 60000;
      sumMinutes += minutes;
      if (minutes <= thresholdMinutes) onTime += 1;
    }
    return {
      totalDelivered: delivered.length,
      onTime,
      breached: delivered.length - onTime,
      sumMinutes,
      failedCount: this.rows.filter((r) => r.failedAt && inRange(r.failedAt) && inScope(r)).length,
    };
  }
  async slaStatsByDepot(range: ReportRange, thresholdMinutes: number): Promise<DepotSlaStats[]> {
    const inRange = (d: Date): boolean =>
      (!range.from || d.getTime() >= range.from.getTime()) &&
      (!range.to || d.getTime() < range.to.getTime());
    const byDepot = new Map<string, DepotSlaStats>();
    for (const r of this.rows) {
      if (!r.depotId || !r.deliveredAt || !inRange(r.deliveredAt)) continue;
      const cur =
        byDepot.get(r.depotId) ??
        { depotId: r.depotId, totalDelivered: 0, onTime: 0, breached: 0, sumMinutes: 0 };
      const minutes = (r.deliveredAt.getTime() - r.assignedAt.getTime()) / 60000;
      cur.totalDelivered += 1;
      cur.sumMinutes += minutes;
      if (minutes <= thresholdMinutes) cur.onTime += 1;
      cur.breached = cur.totalDelivered - cur.onTime;
      byDepot.set(r.depotId, cur);
    }
    return [...byDepot.values()];
  }
}

export class FakeOrderCoordination implements OrderCoordinationPort {
  throwOnAdvance = false;
  calls: { orderId: string; status: OrderFulfilmentStatus }[] = [];

  async advanceStatus(orderId: string, status: OrderFulfilmentStatus): Promise<void> {
    if (this.throwOnAdvance) {
      throw new Error('order-service down');
    }
    this.calls.push({ orderId, status });
  }
}

const OPEN: ShiftStatus[] = [ShiftStatus.ONLINE, ShiftStatus.BREAK, ShiftStatus.OFFLINE];

export class InMemoryShiftRepository implements ShiftRepository {
  rows: ShiftRecord[] = [];

  async open(data: OpenShiftData): Promise<ShiftRecord> {
    const rec: ShiftRecord = {
      ...data,
      id: randomUUID(),
      status: ShiftStatus.ONLINE,
      checkOutAt: null,
      checkOutLat: null,
      checkOutLng: null,
      breakSecondsUsed: 0,
      breakStartedAt: null,
    };
    this.rows.push(rec);
    return clone(rec);
  }
  async findById(id: string): Promise<ShiftRecord | null> {
    const row = this.rows.find((r) => r.id === id);
    return row ? clone(row) : null;
  }
  async findOpenByDriver(driverId: string): Promise<ShiftRecord | null> {
    const row = this.rows.find((r) => r.driverId === driverId && OPEN.includes(r.status));
    return row ? clone(row) : null;
  }
  async patchStatus(id: string, patch: ShiftStatusPatch): Promise<ShiftRecord> {
    const row = this.rows.find((r) => r.id === id)!;
    Object.assign(row, patch);
    return clone(row);
  }
  async listByDriver(driverId: string, limit: number): Promise<ShiftRecord[]> {
    return this.rows
      .filter((r) => r.driverId === driverId)
      .sort((a, b) => b.checkInAt.getTime() - a.checkInAt.getTime())
      .slice(0, limit)
      .map((r) => clone(r));
  }
  async search(query: ShiftQuery): Promise<ShiftRecord[]> {
    return this.rows
      .filter((r) => !query.depotId || r.depotId === query.depotId)
      .filter((r) => !query.from || r.checkInAt.getTime() >= query.from.getTime())
      .filter((r) => !query.to || r.checkInAt.getTime() <= query.to.getTime())
      .map((r) => clone(r));
  }
}

export class InMemoryIncidentRepository implements IncidentRepository {
  rows: IncidentRecord[] = [];

  async create(data: CreateIncidentData): Promise<IncidentRecord> {
    const rec: IncidentRecord = { ...data, id: randomUUID(), createdAt: nextDate() };
    this.rows.push(rec);
    return clone(rec);
  }
  async listByDriver(driverId: string, limit: number): Promise<IncidentRecord[]> {
    return this.rows
      .filter((r) => r.driverId === driverId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit)
      .map((r) => clone(r));
  }
}

export class FakeOpsNotifier implements OpsNotifierPort {
  alerts: OpsIncidentAlert[] = [];
  throwOnAlert = false;

  async incidentReported(alert: OpsIncidentAlert): Promise<void> {
    if (this.throwOnAlert) {
      throw new Error('crm down');
    }
    this.alerts.push(alert);
  }
}

/** Depot fixed at the Bandung coordinates the designs use. */
export class FakeDepotLocation implements DepotLocationPort {
  depot: DepotLocation | null = {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'Depot Kemang',
    lat: -6.9147,
    lng: 107.6098,
  };
  throwOnFind = false;

  async find(): Promise<DepotLocation | null> {
    if (this.throwOnFind) {
      throw new Error('depot-service down');
    }
    return this.depot;
  }
}

export function buildTestConfig(overrides: Record<string, string> = {}): DeliveryConfigService {
  const env: Record<string, string> = {
    NODE_ENV: 'test',
    DELIVERY_SERVICE_PORT: '3006',
    DELIVERY_DATABASE_URL: 'postgresql://u:p@localhost:5432/db?schema=public',
    JWT_ACCESS_SECRET: 'test-access-secret-that-is-long-enough-01',
    ORDER_SERVICE_URL: 'http://localhost:3004',
    DEPOT_SERVICE_URL: 'http://localhost:3007',
    PAYMENT_SERVICE_URL: 'http://localhost:3005',
    MAX_ACTIVE_DELIVERIES_PER_DRIVER: '1',
    SHIFT_CHECKIN_RADIUS_M: '200',
    SHIFT_LENGTH_HOURS: '8',
    SHIFT_BREAK_QUOTA_MINUTES: '30',
    NO_SHOW_MIN_CONTACT_ATTEMPTS: '2',
    NO_SHOW_MIN_WAIT_SECONDS: '300',
    DELIVERY_SLA_MINUTES: '120',
    COURIER_WEEKLY_TARGET: '45',
    POD_RETENTION_DAYS: '365',
    CORS_ALLOWED_ORIGINS: 'http://localhost:3000',
    RATE_LIMIT_TTL_SECONDS: '60',
    RATE_LIMIT_MAX: '100',
    ...overrides,
  };
  const fake = {
    get: <T>(k: string, d?: T): T => (env[k] as unknown as T) ?? (d as T),
    getOrThrow: (k: string): string => {
      if (env[k] === undefined) throw new Error(`missing ${k}`);
      return env[k];
    },
  };
  return new DeliveryConfigService(fake as unknown as ConfigService);
}

export class InMemorySettlementRepository implements SettlementRepository {
  rows: SettlementRecord[] = [];

  async create(data: CreateSettlementData): Promise<SettlementRecord> {
    const now = nextDate();
    const rec: SettlementRecord = {
      ...data,
      id: randomUUID(),
      status: SettlementStatus.SUBMITTED,
      chargedToDriver: false,
      note: null,
      verifiedBy: null,
      verifiedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.push(rec);
    return clone(rec);
  }
  async findById(id: string): Promise<SettlementRecord | null> {
    const row = this.rows.find((r) => r.id === id);
    return row ? clone(row) : null;
  }
  async findByShift(shiftId: string): Promise<SettlementRecord | null> {
    const row = this.rows.find((r) => r.shiftId === shiftId);
    return row ? clone(row) : null;
  }
  async listByDriver(driverId: string, limit: number): Promise<SettlementRecord[]> {
    return this.rows
      .filter((r) => r.driverId === driverId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit)
      .map((r) => clone(r));
  }
  async search(query: SettlementQuery): Promise<SettlementRecord[]> {
    return this.rows
      .filter((r) => r.depotId === query.depotId)
      .filter((r) => !query.status || r.status === query.status)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((r) => clone(r));
  }
  async chargedShortfallByDriver(
    depotId: string,
    from: Date,
    to: Date,
  ): Promise<CourierShortfall[]> {
    const byDriver = new Map<string, number>();
    for (const r of this.rows) {
      if (
        r.depotId === depotId &&
        r.chargedToDriver &&
        r.createdAt.getTime() >= from.getTime() &&
        r.createdAt.getTime() < to.getTime()
      ) {
        byDriver.set(r.driverId, (byDriver.get(r.driverId) ?? 0) + Math.abs(r.variance));
      }
    }
    return [...byDriver].map(([driverId, shortfallIdr]) => ({ driverId, shortfallIdr }));
  }
  async resolve(id: string, patch: ResolveSettlementPatch): Promise<SettlementRecord> {
    const row = this.rows.find((r) => r.id === id)!;
    Object.assign(row, patch, { updatedAt: nextDate() });
    return clone(row);
  }
}

export class FakeCourierPayout implements CourierPayoutPort {
  events: DeliveryCompletedEvent[] = [];
  variances: CashVarianceChargedEvent[] = [];
  async deliveryCompleted(event: DeliveryCompletedEvent): Promise<void> {
    this.events.push(event);
  }
  async cashVarianceCharged(event: CashVarianceChargedEvent): Promise<void> {
    this.variances.push(event);
  }
}

export class FakeRating implements RatingPort {
  /** rating keyed by orderId; unknown orders contribute nothing. */
  ratings = new Map<string, number>();
  calls: string[][] = [];

  async avgRating(orderIds: string[]): Promise<RatingSummary> {
    this.calls.push(orderIds);
    const found = orderIds.map((id) => this.ratings.get(id)).filter((r): r is number => r != null);
    if (found.length === 0) return { average: null, count: 0 };
    return { average: found.reduce((s, r) => s + r, 0) / found.length, count: found.length };
  }
}

export class FakeCashCollection implements CashCollectionPort {
  throwOnRead = false;
  result: CashCollected = { total: 0, count: 0 };
  calls: { orderIds: string[]; authorization: string }[] = [];

  async sumCollected(orderIds: string[], authorization: string): Promise<CashCollected> {
    this.calls.push({ orderIds, authorization });
    if (this.throwOnRead) {
      throw new Error('payment-service down');
    }
    return this.result;
  }
}
