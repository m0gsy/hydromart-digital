import 'reflect-metadata';

import { UnprocessableEntityException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { AiCustomerMetricsService, MAX_AI_DEPOTS } from '../../src/application/services/ai-customer-metrics.service';
import { AiSpan } from '../../src/application/ports/ai-customer.repository';
import { AiCustomerPrismaRepository } from '../../src/infrastructure/prisma/ai-customer.prisma.repository';
import { AiCustomerMetricsController } from '../../src/modules/ai-customer-metrics.controller';
import { AiCustomerMetricsDto, AiLiveOrdersQueryDto, AiSegmentsDto, AiSpansDto } from '../../src/modules/dto/ai-customer.dto';

/*
 * HD-6 H3: the customer and gallon facts of the AI read API. The SQL itself runs on a real Postgres
 * in test/race/ai-customer.race.ts; here the spans checks, the DTO bounds, the row mapping and the
 * controller are covered.
 */
const D1 = '11111111-1111-4111-8111-111111111111';
const D2 = '22222222-2222-4222-8222-222222222222';
const from = new Date('2026-10-31T17:00:00.000Z');
const to = new Date('2026-11-30T17:00:00.000Z');
const span = (depotId: string, f = from, t = to): AiSpan => ({ depotId, from: f, to: t });

describe('AiCustomerMetricsService', () => {
  const repo = {
    customerWindow: jest.fn().mockResolvedValue('window'),
    customerCohorts: jest.fn().mockResolvedValue(['cell']),
    ratingStats: jest.fn().mockResolvedValue('ratings'),
    customerSegments: jest.fn().mockResolvedValue('segments'),
    gallonsSold: jest.fn().mockResolvedValue([{ depotId: D1, gallons: 40 }, { depotId: D2, gallons: 2 }]),
    refillSplit: jest.fn().mockResolvedValue('split'),
    liveByStatus: jest.fn().mockResolvedValue([{ status: 'CREATED', count: 2 }]),
    cancelledBeforeDeparture: jest.fn().mockResolvedValue(4),
  };
  const service = new AiCustomerMetricsService(repo as never, { businessTimeZone: 'Asia/Jakarta' } as never);

  it('passes valid spans through to each read', async () => {
    await expect(service.customers([span(D1)], from)).resolves.toBe('window');
    await expect(service.cohorts([span(D1)])).resolves.toEqual(['cell']);
    expect(repo.customerCohorts).toHaveBeenCalledWith([span(D1)], 'Asia/Jakarta');
    await expect(service.ratings([span(D1)])).resolves.toBe('ratings');
    await expect(service.gallons([span(D1)])).resolves.toEqual({ gallons: 42, byDepot: [{ depotId: D1, gallons: 40 }, { depotId: D2, gallons: 2 }] });
    await expect(service.refill([span(D1)])).resolves.toBe('split');
    const at = { activeSince: from, riskSince: from, until: to };
    await expect(service.segments([D1], at)).resolves.toBe('segments');
    await expect(service.live([D1])).resolves.toEqual({ byStatus: [{ status: 'CREATED', count: 2 }] });
    await expect(service.cancelledBeforeDeparture([span(D1)])).resolves.toEqual({ cancelled: 4 });
  });

  it('refuses more than 100 depots with 422, never a silent cut', () => {
    const ids = Array.from({ length: MAX_AI_DEPOTS + 1 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    expect(() => service.customers(ids.map((id) => span(id)), from)).toThrow(UnprocessableEntityException);
    expect(() => service.live(ids)).toThrow(UnprocessableEntityException);
    expect(() => service.segments(ids, { activeSince: from, riskSince: from, until: to })).toThrow(UnprocessableEntityException);
    // exactly 100 is fine
    expect(() => service.live(ids.slice(0, MAX_AI_DEPOTS))).not.toThrow();
  });

  it('refuses two overlapping spans of one depot (an order would count twice), allows touching ones', () => {
    const mid = new Date('2026-11-15T17:00:00.000Z');
    expect(() => service.gallons([span(D1, from, mid), span(D1, new Date(mid.getTime() - 1), to)])).toThrow(UnprocessableEntityException);
    expect(() => service.gallons([span(D1, mid, to), span(D1, from, mid)])).not.toThrow();
    expect(() => service.gallons([span(D1, from, to), span(D2, from, to)])).not.toThrow();
  });
});

describe('AiCustomerPrismaRepository row mapping', () => {
  const make = (queryRaw: jest.Mock, groupBy: jest.Mock = jest.fn()) =>
    new AiCustomerPrismaRepository({ $queryRaw: queryRaw, order: { groupBy } } as never);

  it('maps the customer window and the per-depot first orders to numbers', async () => {
    const q = jest
      .fn()
      .mockResolvedValueOnce([{ active: 10n, newCustomers: 4n, repeat: 6n }])
      .mockResolvedValueOnce([{ depotId: D1, customers: 3n }]);
    await expect(make(q).customerWindow([span(D1)], from)).resolves.toEqual({
      active: 10,
      newCustomers: 4,
      repeat: 6,
      newAtDepot: [{ depotId: D1, customers: 3 }],
    });
  });

  it('reads an empty answer as zeros, never NaN', async () => {
    const q = jest.fn().mockResolvedValue([]);
    const repo = make(q);
    await expect(repo.customerWindow([span(D1)], from)).resolves.toEqual({ active: 0, newCustomers: 0, repeat: 0, newAtDepot: [] });
    await expect(repo.ratingStats([span(D1)])).resolves.toEqual({ reviews: 0, ratingSum: 0, reviewers: 0 });
    await expect(repo.customerSegments([D1], { activeSince: from, riskSince: from, until: to })).resolves.toEqual({ active: 0, atRisk: 0, inactive: 0 });
    await expect(repo.gallonsSold([span(D1)])).resolves.toEqual([]);
    await expect(repo.refillSplit([span(D1)])).resolves.toEqual({ refill: 0, partial: 0, beli: 0, notAsked: 0 });
  });

  it('maps cohorts, ratings, segments, gallons and the refill split', async () => {
    const q = jest
      .fn()
      .mockResolvedValueOnce([{ cohort: '2026-10', monthIndex: 1, customers: 5n }])
      .mockResolvedValueOnce([{ reviews: 7n, ratingSum: 30n, reviewers: 5n }])
      .mockResolvedValueOnce([{ active: 5n, atRisk: 2n, inactive: 1n }])
      .mockResolvedValueOnce([{ depotId: D1, gallons: null }, { depotId: D2, gallons: 7n }])
      .mockResolvedValueOnce([{ refill: 3n, partial: 1n, beli: 2n, notAsked: 4n }])
      .mockResolvedValueOnce([{ n: 6n }])
      .mockResolvedValueOnce([]);
    const repo = make(q);
    await expect(repo.customerCohorts([span(D1)], 'Asia/Jakarta')).resolves.toEqual([{ cohort: '2026-10', monthIndex: 1, customers: 5 }]);
    await expect(repo.ratingStats([span(D1)])).resolves.toEqual({ reviews: 7, ratingSum: 30, reviewers: 5 });
    await expect(repo.customerSegments([D1], { activeSince: from, riskSince: from, until: to })).resolves.toEqual({ active: 5, atRisk: 2, inactive: 1 });
    await expect(repo.gallonsSold([span(D1)])).resolves.toEqual([{ depotId: D1, gallons: 0 }, { depotId: D2, gallons: 7 }]);
    await expect(repo.refillSplit([span(D1)])).resolves.toEqual({ refill: 3, partial: 1, beli: 2, notAsked: 4 });
    await expect(repo.cancelledBeforeDeparture([span(D1)])).resolves.toBe(6);
    await expect(repo.cancelledBeforeDeparture([span(D1)])).resolves.toBe(0);
  });

  it('counts only in-flight orders of the asked depots, and nothing for no depot', async () => {
    const groupBy = jest.fn().mockResolvedValue([{ status: 'PREPARING', _count: { _all: 3 } }]);
    const repo = make(jest.fn(), groupBy);
    await expect(repo.liveByStatus([])).resolves.toEqual([]);
    expect(groupBy).not.toHaveBeenCalled();
    await expect(repo.liveByStatus([D1])).resolves.toEqual([{ status: 'PREPARING', count: 3 }]);
    const where = groupBy.mock.calls[0][0].where;
    expect(where.depotId).toEqual({ in: [D1] });
    expect(where.status.in).not.toContain('DELIVERED');
    expect(where.status.in).not.toContain('CANCELLED');
    // a counter sale is never in flight: the live read is delivery orders only
    expect(where.isWalkIn).toBe(false);
  });
});

describe('AiCustomerMetricsController and DTOs', () => {
  const metrics = {
    customers: jest.fn().mockResolvedValue('c'),
    cohorts: jest.fn().mockResolvedValue(['x']),
    ratings: jest.fn().mockResolvedValue('r'),
    segments: jest.fn().mockResolvedValue('s'),
    gallons: jest.fn().mockResolvedValue('g'),
    refill: jest.fn().mockResolvedValue('f'),
    live: jest.fn().mockResolvedValue('l'),
    cancelledBeforeDeparture: jest.fn().mockResolvedValue('x'),
  };
  const controller = new AiCustomerMetricsController(metrics as never);
  const spans = [{ depotId: D1, from: from.toISOString(), to: to.toISOString() }];

  it('turns the body into dates and calls the service', async () => {
    await controller.customers({ spans, periodFrom: from.toISOString() } as never);
    expect(metrics.customers).toHaveBeenCalledWith([span(D1)], from);
    await expect(controller.cohorts({ spans } as never)).resolves.toEqual({ cells: ['x'] });
    await controller.ratings({ spans } as never);
    await controller.gallons({ spans } as never);
    await controller.refill({ spans } as never);
    await controller.segments({
      depotIds: `${D1},${D2}`,
      riskSince: '2026-09-01T00:00:00.000Z',
      activeSince: '2026-10-01T00:00:00.000Z',
      until: '2026-11-01T00:00:00.000Z',
    } as never);
    expect(metrics.segments).toHaveBeenCalledWith([D1, D2], {
      riskSince: new Date('2026-09-01T00:00:00.000Z'),
      activeSince: new Date('2026-10-01T00:00:00.000Z'),
      until: new Date('2026-11-01T00:00:00.000Z'),
    });
    await controller.cancelledBeforeDeparture({ spans } as never);
    expect(metrics.cancelledBeforeDeparture).toHaveBeenCalledWith([span(D1)]);
    await controller.live({ depotIds: D1 } as never);
    expect(metrics.live).toHaveBeenCalledWith([D1]);
  });

  const errors = async (cls: new () => object, body: object) => (await validate(plainToInstance(cls, body))).length;

  it('rejects a span that runs backwards, is over a leap year, or is not a real date', async () => {
    const ok = { periodFrom: from.toISOString(), spans };
    expect(await errors(AiCustomerMetricsDto, ok)).toBe(0);
    const bad = (s: object) => errors(AiCustomerMetricsDto, { ...ok, spans: [{ depotId: D1, ...s }] });
    expect(await bad({ from: to.toISOString(), to: from.toISOString() })).toBeGreaterThan(0);
    expect(await bad({ from: '2025-01-01T00:00:00.000Z', to: '2026-11-30T00:00:00.000Z' })).toBeGreaterThan(0);
    expect(await bad({ from: '2026-02-30T00:00:00.000Z', to: '2026-03-31T00:00:00.000Z' })).toBeGreaterThan(0);
    expect(await errors(AiSpansDto, { spans: [] })).toBeGreaterThan(0);
    expect(await errors(AiSpansDto, { spans: Array.from({ length: 201 }, () => spans[0]) })).toBeGreaterThan(0);
    expect(await errors(AiSpansDto, { spans: [{ ...spans[0], depotId: 'nope' }] })).toBeGreaterThan(0);
  });

  it('bounds the segment thresholds and the depot lists', async () => {
    const seg = { depotIds: D1, riskSince: '2026-09-01T00:00:00.000Z', activeSince: '2026-10-01T00:00:00.000Z', until: '2026-11-01T00:00:00.000Z' };
    expect(await errors(AiSegmentsDto, seg)).toBe(0);
    expect(await errors(AiSegmentsDto, { ...seg, activeSince: '2026-08-01T00:00:00.000Z' })).toBeGreaterThan(0);
    expect(await errors(AiSegmentsDto, { ...seg, depotIds: 'x' })).toBeGreaterThan(0);
    // thresholds more than 70 days apart are not a recency read
    expect(await errors(AiSegmentsDto, { ...seg, until: '2027-06-01T00:00:00.000Z' })).toBeGreaterThan(0);
    expect(await errors(AiSegmentsDto, { ...seg, activeSince: '2026-12-31T00:00:00.000Z', until: '2027-01-01T00:00:00.000Z' })).toBeGreaterThan(0);
    const many = Array.from({ length: 101 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`).join(',');
    expect(await errors(AiLiveOrdersQueryDto, { depotIds: many })).toBeGreaterThan(0);
    expect(await errors(AiLiveOrdersQueryDto, { depotIds: D1 })).toBe(0);
  });
});

describe('HD-20c area points', () => {
  const C1 = 'c1111111-1111-4111-8111-111111111111';
  const C2 = 'c2222222-2222-4222-8222-222222222222';
  const row = (customerId: string, latitude: number | null, longitude: number | null, orders = 1n, galon = 2n) => ({ customerId, latitude, longitude, orders, galon });
  const make = (rows: unknown[]) => new AiCustomerPrismaRepository({ $queryRaw: jest.fn().mockResolvedValue(rows) } as never);

  it('numbers customers 0,1,.. within the answer, keeps one entry per pin and never returns an id', async () => {
    const r = await make([row(C1, -6.2, 106.8), row(C2, -6.3, 106.9, 3n, 0n), row(C1, -6.21, 106.81)]).areaPoints([span(D1)], 10);
    expect(r).toEqual({
      points: [
        { k: 0, lat: -6.2, lng: 106.8, orders: 1, galon: 2 },
        { k: 1, lat: -6.3, lng: 106.9, orders: 3, galon: 0 },
        { k: 0, lat: -6.21, lng: 106.81, orders: 1, galon: 2 },
      ],
    });
    expect(JSON.stringify(r)).not.toContain(C1);
  });

  it('keeps an order with no pin as a null pin of the same customer number', async () => {
    const r = await make([row(C1, -6.2, 106.8), row(C1, null, null, 2n, 1n)]).areaPoints([span(D1)], 10);
    expect(r?.points).toEqual([
      { k: 0, lat: -6.2, lng: 106.8, orders: 1, galon: 2 },
      { k: 0, lat: null, lng: null, orders: 2, galon: 1 },
    ]);
  });

  it('answers null past the limit, and the service turns that into 422', async () => {
    const rows = [row(C1, -6.2, 106.8), row(C2, -6.3, 106.9)];
    await expect(make(rows).areaPoints([span(D1)], 1)).resolves.toBeNull();
    const service = new AiCustomerMetricsService({ areaPoints: jest.fn().mockResolvedValue(null) } as never, {} as never);
    await expect(service.areaPoints([span(D1)])).rejects.toThrow(UnprocessableEntityException);
    const ok = new AiCustomerMetricsService({ areaPoints: jest.fn().mockResolvedValue('pts') } as never, {} as never);
    await expect(ok.areaPoints([span(D1)])).resolves.toBe('pts');
    expect(() => ok.areaPoints([span(D1, from, to), span(D1, from, to)])).rejects.toThrow(UnprocessableEntityException);
  });

  it('the controller passes the spans through as dates', async () => {
    const metrics = { areaPoints: jest.fn().mockResolvedValue('p') };
    const c = new AiCustomerMetricsController(metrics as never);
    await expect(c.areaPoints({ spans: [{ depotId: D1, from: from.toISOString(), to: to.toISOString() }] } as never)).resolves.toBe('p');
    expect(metrics.areaPoints).toHaveBeenCalledWith([span(D1)]);
  });
});
