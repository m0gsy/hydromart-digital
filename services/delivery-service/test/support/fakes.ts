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
} from '../../src/application/ports/delivery.repository';
import { OrderCoordinationPort } from '../../src/application/ports/order-coordination.port';

let seq = 0;
const nextDate = (): Date => new Date(1_800_000_000_000 + (seq += 1) * 1000);

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
    return structuredClone(rec);
  }
  async findById(id: string): Promise<DeliveryRecord | null> {
    const row = this.rows.find((r) => r.id === id);
    return row ? structuredClone(row) : null;
  }
  async findByOrder(orderId: string): Promise<DeliveryRecord | null> {
    const row = this.rows.find((r) => r.orderId === orderId);
    return row ? structuredClone(row) : null;
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
      items: all.slice(start, start + query.limit).map((r) => structuredClone(r)),
      total: all.length,
    };
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
    return structuredClone(row);
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
    return structuredClone(row);
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
