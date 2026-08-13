import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { CampaignPageQueryDto, CampaignSegmentDto } from '../../src/modules/dto/campaign.dto';
import { CampaignService } from '../../src/application/services/campaign.service';
import { NotificationController } from '../../src/modules/notification.controller';
import { NotificationPrismaRepository } from '../../src/infrastructure/prisma/notification.prisma.repository';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { envValidationSchema } from '../../src/config/env.validation';

/**
 * The paths a request takes when the caller supplies NOTHING — defaults, retention
 * sweeps and the env schema. Each is exercised in production on a schedule or on
 * every unparameterised call, and each was uncovered.
 */
/*
 * A segment arrives as JSON, but the console builds it from query-string handoffs and
 * number inputs, so the day-windows can turn up as strings. Without the @Type transform
 * every activity segment 400s and the campaign silently stays an attribute-only blast.
 */
describe('CampaignSegmentDto', () => {
  const parse = (q: Record<string, unknown>) => plainToInstance(CampaignSegmentDto, q);

  it('coerces the activity day-windows to numbers', () => {
    const dto = parse({ recencyDays: '30', lapsedDays: '60', newWithinDays: '14', minOrders: '5' });
    expect(dto).toMatchObject({ recencyDays: 30, lapsedDays: 60, newWithinDays: 14, minOrders: 5 });
    expect(validateSync(dto)).toHaveLength(0);
  });

  it.each([
    ['a zero day-window', { lapsedDays: '0' }],
    ['a depotId that is not a uuid', { depotId: 'depot-1' }],
  ])('rejects %s', (_case, q) => {
    expect(validateSync(parse(q)).length).toBeGreaterThan(0);
  });
});

describe('CampaignPageQueryDto', () => {
  const parse = (q: Record<string, unknown>) => plainToInstance(CampaignPageQueryDto, q);

  // The @Type(() => Number) transform is why `?page=2` from a query string validates
  // at all — without it every paged endpoint 400s on a string.
  it('coerces the query-string values to numbers', () => {
    const dto = parse({ page: '2', limit: '50' });
    expect(dto.page).toBe(2);
    expect(dto.limit).toBe(50);
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('falls back to page 1 / limit 20 when nothing is supplied', () => {
    const dto = parse({});
    expect(dto).toMatchObject({ page: 1, limit: 20 });
    expect(validateSync(dto)).toHaveLength(0);
  });

  it.each([
    ['page below the minimum', { page: '0' }],
    ['limit above the maximum', { limit: '101' }],
    ['a non-numeric page', { page: 'abc' }],
  ])('rejects %s', (_case, q) => {
    expect(validateSync(parse(q)).length).toBeGreaterThan(0);
  });
});

describe('CampaignService.list defaults', () => {
  const repo = { list: jest.fn().mockResolvedValue({ items: [], total: 0 }) };
  const service = new CampaignService(
    repo as never,
    { send: jest.fn() } as never,
    { resolve: jest.fn() } as never,
    { customersIn: jest.fn() } as never,
  );

  beforeEach(() => repo.list.mockClear());

  it('pages from 1 with a limit of 20 when called with no arguments', async () => {
    await service.list();
    expect(repo.list).toHaveBeenCalledWith(1, 20);
  });

  // Clamping, not rejecting: a paged list is a read, and a nonsense page is far more
  // often a stale bookmark than an attack.
  it.each([
    ['a page below 1', [0, 20], [1, 20]],
    ['a negative page', [-5, 20], [1, 20]],
    ['a limit below 1', [1, 0], [1, 1]],
    ['a limit above the cap', [1, 5000], [1, 100]],
  ])('clamps %s', async (_case, [page, limit], [p, l]) => {
    await service.list(page, limit);
    expect(repo.list).toHaveBeenCalledWith(p, l);
  });
});

describe('NotificationPrismaRepository.deleteOlderThan', () => {
  // The retention purge (UU PDP). It runs unattended, so "how many rows went" is the
  // only signal anybody ever sees from it.
  it('deletes by cutoff and reports the count back', async () => {
    const deleteMany = jest.fn().mockResolvedValue({ count: 42 });
    const repo = new NotificationPrismaRepository({
      notification: { deleteMany },
    } as unknown as PrismaService);

    const cutoff = new Date('2026-01-01T00:00:00.000Z');
    expect(await repo.deleteOlderThan(cutoff)).toBe(42);
    expect(deleteMany).toHaveBeenCalledWith({ where: { createdAt: { lt: cutoff } } });
  });

  it('reports zero when nothing was old enough', async () => {
    const repo = new NotificationPrismaRepository({
      notification: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    } as unknown as PrismaService);
    expect(await repo.deleteOlderThan(new Date())).toBe(0);
  });
});

describe('NotificationController.purge', () => {
  // The retention sweep's HTTP door. admin-service owns the policy and passes the
  // cutoff in, so this route must forward the DATE it was given, not recompute one.
  it('forwards the cutoff as a Date and returns the deleted count', async () => {
    const purgeOlderThan = jest.fn().mockResolvedValue({ deleted: 7 });
    const controller = new NotificationController({ purgeOlderThan } as never);

    expect(await controller.purge({ cutoff: '2026-01-01T00:00:00.000Z' })).toEqual({ deleted: 7 });
    expect(purgeOlderThan).toHaveBeenCalledWith(new Date('2026-01-01T00:00:00.000Z'));
  });
});

describe('env validation schema', () => {
  const base = {
    CRM_DATABASE_URL: 'postgresql://u:p@localhost:5432/db?schema=public',
    JWT_ACCESS_SECRET: 'a-test-access-secret-that-is-long-enough',
  };

  it('accepts a minimal valid environment and applies the defaults', () => {
    const { error, value } = envValidationSchema.validate(base, { allowUnknown: true });
    expect(error).toBeUndefined();
    expect(value.NODE_ENV).toBe('development');
  });

  // Fail at BOOT, not at the first request: a service that starts without its database
  // URL only reveals it to whoever hits the first endpoint.
  it('refuses to boot without the database url', () => {
    const { error } = envValidationSchema.validate(
      { ...base, CRM_DATABASE_URL: undefined },
      { allowUnknown: true },
    );
    expect(error).toBeDefined();
  });

  it('rejects an unknown NODE_ENV', () => {
    const { error } = envValidationSchema.validate(
      { ...base, NODE_ENV: 'staging' },
      { allowUnknown: true },
    );
    expect(error).toBeDefined();
  });
});
