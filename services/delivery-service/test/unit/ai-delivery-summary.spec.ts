import 'reflect-metadata';

import { UnprocessableEntityException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { AiDeliverySummaryService, MAX_AI_DEPOTS } from '../../src/application/services/ai-delivery-summary.service';
import { AiSpan } from '../../src/application/ports/ai-delivery.repository';
import { AiDeliveryPrismaRepository } from '../../src/infrastructure/prisma/ai-delivery.prisma.repository';
import { AiDeliverySummaryController } from '../../src/modules/ai-delivery-summary.controller';
import { AiSpansDto } from '../../src/modules/dto/ai-delivery.dto';

/*
 * HD-6 H3: the delivered / failed summary of the AI read API. The SQL runs on a real Postgres in
 * test/race/ai-delivery.race.ts; here the spans checks, the mapping, the DTO bounds and the
 * controller are covered.
 */
const D1 = '11111111-1111-4111-8111-111111111111';
const from = new Date('2026-10-31T17:00:00.000Z');
const to = new Date('2026-11-30T17:00:00.000Z');
const span = (depotId: string, f = from, t = to): AiSpan => ({ depotId, from: f, to: t });

describe('AiDeliverySummaryService', () => {
  const repo = {
    deliveredStats: jest.fn().mockResolvedValue({ delivered: 10, onTime: 8, storedVerdicts: 6, medianMinutes: 41.26, couriers: 3 }),
    failedStats: jest.fn().mockResolvedValue({ failed: 5, noShow: 2, rescheduled: 4 }),
  };
  const service = new AiDeliverySummaryService(repo as never, { slaMinutes: () => 90 } as never);

  it('joins the two reads, rounds the median to one decimal and splits the failures', async () => {
    await expect(service.summary([span(D1)])).resolves.toEqual({
      delivered: 10,
      onTime: 8,
      storedVerdicts: 6,
      thresholdMinutes: 90,
      medianMinutes: 41.3,
      couriers: 3,
      failed: 5,
      noShow: 2,
      otherFailed: 3,
      rescheduled: 4,
    });
    expect(repo.deliveredStats).toHaveBeenCalledWith([{ ...span(D1), thresholdMinutes: 90 }]);
  });

  it('grades old rows with each depot own threshold, and says null when the depots in scope differ', async () => {
    const mixed = new AiDeliverySummaryService(repo as never, { slaMinutes: (d: string) => (d === D1 ? 60 : 120) } as never);
    const D2 = '22222222-2222-4222-8222-222222222222';
    await expect(mixed.summary([span(D1), span(D2)])).resolves.toMatchObject({ thresholdMinutes: null });
    expect(repo.deliveredStats).toHaveBeenLastCalledWith([
      { ...span(D1), thresholdMinutes: 60 },
      { ...span(D2), thresholdMinutes: 120 },
    ]);
    await expect(mixed.summary([span(D1)])).resolves.toMatchObject({ thresholdMinutes: 60 });
  });

  it('keeps a null median null (no delivery), never 0', async () => {
    repo.deliveredStats.mockResolvedValueOnce({ delivered: 0, onTime: 0, storedVerdicts: 0, medianMinutes: null, couriers: 0 });
    await expect(service.summary([span(D1)])).resolves.toMatchObject({ delivered: 0, medianMinutes: null });
  });

  it('refuses more than 100 depots and overlapping spans of one depot with 422', async () => {
    const ids = Array.from({ length: MAX_AI_DEPOTS + 1 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    await expect(service.summary(ids.map((id) => span(id)))).rejects.toBeInstanceOf(UnprocessableEntityException);
    const mid = new Date('2026-11-15T17:00:00.000Z');
    await expect(service.summary([span(D1, from, mid), span(D1, new Date(mid.getTime() - 1), to)])).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    await expect(service.summary([span(D1, from, mid), span(D1, mid, to)])).resolves.toBeDefined();
  });
});

describe('AiDeliveryPrismaRepository row mapping', () => {
  it('maps counts to numbers and an empty read to zeros with a null median', async () => {
    const q = jest
      .fn()
      .mockResolvedValueOnce([{ delivered: 4n, onTime: 3n, stored: 2n, median: 35.5 }])
      .mockResolvedValueOnce([{ couriers: 2n }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ failed: 3n, noShow: 1n }])
      .mockResolvedValueOnce([{ rescheduled: 2n }])
      .mockResolvedValueOnce([{ failed: 0n, noShow: 0n }])
      .mockResolvedValueOnce([]);
    const repo = new AiDeliveryPrismaRepository({ $queryRaw: q } as never);
    await expect(repo.deliveredStats([{ ...span(D1), thresholdMinutes: 90 }])).resolves.toEqual({ delivered: 4, onTime: 3, storedVerdicts: 2, medianMinutes: 35.5, couriers: 2 });
    await expect(repo.deliveredStats([{ ...span(D1), thresholdMinutes: 90 }])).resolves.toEqual({ delivered: 0, onTime: 0, storedVerdicts: 0, medianMinutes: null, couriers: 0 });
    await expect(repo.failedStats([span(D1)])).resolves.toEqual({ failed: 3, noShow: 1, rescheduled: 2 });
    await expect(repo.failedStats([span(D1)])).resolves.toEqual({ failed: 0, noShow: 0, rescheduled: 0 });
  });
});

describe('AiDeliverySummaryController and DTO', () => {
  it('turns the body into dates', async () => {
    const summary = jest.fn().mockResolvedValue('s');
    const controller = new AiDeliverySummaryController({ summary } as never);
    await controller.summary({ spans: [{ depotId: D1, from: from.toISOString(), to: to.toISOString() }] });
    expect(summary).toHaveBeenCalledWith([span(D1)]);
  });

  const errors = async (body: object) => (await validate(plainToInstance(AiSpansDto, body))).length;
  const one = { depotId: D1, from: from.toISOString(), to: to.toISOString() };

  it('rejects a backwards span, one over a leap year, an unreal date, an empty or oversized list', async () => {
    expect(await errors({ spans: [one] })).toBe(0);
    expect(await errors({ spans: [{ ...one, from: to.toISOString(), to: from.toISOString() }] })).toBeGreaterThan(0);
    expect(await errors({ spans: [{ ...one, from: '2025-01-01T00:00:00.000Z' }] })).toBeGreaterThan(0);
    expect(await errors({ spans: [{ ...one, from: '2026-02-30T00:00:00.000Z', to: '2026-03-31T00:00:00.000Z' }] })).toBeGreaterThan(0);
    expect(await errors({ spans: [] })).toBeGreaterThan(0);
    expect(await errors({ spans: Array.from({ length: 201 }, () => one) })).toBeGreaterThan(0);
    expect(await errors({ spans: [{ ...one, depotId: 'x' }] })).toBeGreaterThan(0);
  });
});
