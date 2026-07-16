import { randomUUID } from 'node:crypto';

import { ConfigService } from '@nestjs/config';

import { DeliveryConfigService } from '../../src/config/delivery-config.service';
import { DeliveryStatus, OrderFulfilmentStatus } from '../../src/domain/delivery-status';
import {
  CreateDeliveryData,
  DeliveryQuery,
  DeliveryRecord,
  DeliveryRepository,
  DeliveryTimestamps,
  ProofRecord,
  ReportRange,
  SlaStats,
} from '../../src/application/ports/delivery.repository';
import { OrderCoordinationPort } from '../../src/application/ports/order-coordination.port';

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
  async search(query: DeliveryQuery): Promise<{ items: DeliveryRecord[]; total: number }> {
    const all = this.rows
      .filter((r) => !query.driverId || r.driverId === query.driverId)
      .filter((r) => !query.status || r.status === query.status)
      .sort((a, b) => b.assignedAt.getTime() - a.assignedAt.getTime());
    const start = (query.page - 1) * query.limit;
    return {
      items: all.slice(start, start + query.limit).map((r) => clone(r)),
      total: all.length,
    };
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

export function buildTestConfig(overrides: Record<string, string> = {}): DeliveryConfigService {
  const env: Record<string, string> = {
    NODE_ENV: 'test',
    DELIVERY_SERVICE_PORT: '3006',
    DELIVERY_DATABASE_URL: 'postgresql://u:p@localhost:5432/db?schema=public',
    JWT_ACCESS_SECRET: 'test-access-secret-that-is-long-enough-01',
    ORDER_SERVICE_URL: 'http://localhost:3004',
    MAX_ACTIVE_DELIVERIES_PER_DRIVER: '1',
    DELIVERY_SLA_MINUTES: '120',
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
