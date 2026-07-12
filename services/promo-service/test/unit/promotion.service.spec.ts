import { randomUUID } from 'node:crypto';

import {
  CreatePromotionData,
  PromotionRecord,
  PromotionRepository,
  UpdatePromotionData,
} from '../../src/application/ports/promotion.repository';
import { isPromotionLiveAt } from '../../src/domain/promotion';
import { PromotionService } from '../../src/application/services/promotion.service';

// Minimal in-memory repo whose findActive reuses the pure domain predicate, so
// the date-window filter is exercised through the service exactly as in prod.
class InMemoryPromotionRepository implements PromotionRepository {
  rows: PromotionRecord[] = [];

  async findById(id: string): Promise<PromotionRecord | null> {
    return this.rows.find((r) => r.id === id) ?? null;
  }
  async create(data: CreatePromotionData): Promise<PromotionRecord> {
    const now = new Date();
    const row: PromotionRecord = {
      id: randomUUID(),
      active: true,
      createdAt: now,
      updatedAt: now,
      ...data,
    };
    this.rows.push(row);
    return row;
  }
  async update(id: string, data: UpdatePromotionData): Promise<PromotionRecord> {
    const row = this.rows.find((r) => r.id === id)!;
    Object.assign(row, data);
    return row;
  }
  async delete(id: string): Promise<void> {
    this.rows = this.rows.filter((r) => r.id !== id);
  }
  async findAll(): Promise<PromotionRecord[]> {
    return [...this.rows].sort(
      (a, b) => a.sortOrder - b.sortOrder || b.createdAt.getTime() - a.createdAt.getTime(),
    );
  }
  async findActive(now: Date): Promise<PromotionRecord[]> {
    return (await this.findAll()).filter((r) => isPromotionLiveAt(r, now));
  }
}

const base = (overrides: Partial<CreatePromotionData> = {}): CreatePromotionData => ({
  title: 'Promo',
  subtitle: null,
  imageUrl: null,
  ctaLabel: null,
  ctaHref: null,
  voucherCode: null,
  sortOrder: 0,
  startsAt: null,
  endsAt: null,
  ...overrides,
});

describe('PromotionService date-window filter', () => {
  let repo: InMemoryPromotionRepository;
  let service: PromotionService;

  beforeEach(() => {
    repo = new InMemoryPromotionRepository();
    service = new PromotionService(repo);
  });

  it('excludes a promotion whose endsAt is in the past', async () => {
    await service.create(base({ title: 'Expired', endsAt: new Date('2000-01-01T00:00:00.000Z') }));
    const active = await service.listActive(new Date('2026-07-12T00:00:00.000Z'));
    expect(active.map((p) => p.title)).not.toContain('Expired');
  });

  it('includes a promotion with startsAt null and endsAt in the future', async () => {
    await service.create(base({ title: 'Live', endsAt: new Date('2099-01-01T00:00:00.000Z') }));
    const active = await service.listActive(new Date('2026-07-12T00:00:00.000Z'));
    expect(active.map((p) => p.title)).toContain('Live');
  });

  it('excludes an inactive promotion even inside its window', async () => {
    const created = await service.create(base({ title: 'Hidden' }));
    await service.update(created.id, { active: false });
    const active = await service.listActive(new Date('2026-07-12T00:00:00.000Z'));
    expect(active.map((p) => p.title)).not.toContain('Hidden');
  });

  it('excludes a promotion that has not started yet', async () => {
    await service.create(base({ title: 'Scheduled', startsAt: new Date('2099-01-01T00:00:00.000Z') }));
    const active = await service.listActive(new Date('2026-07-12T00:00:00.000Z'));
    expect(active.map((p) => p.title)).not.toContain('Scheduled');
  });
});
