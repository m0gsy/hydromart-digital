import { BadRequestException } from '@nestjs/common';
import { AuthenticatedUser } from '@hydromart/platform';

import { MeterService } from '../../src/application/services/meter.service';
import { MeterController } from '../../src/modules/meter.controller';

const DEPOT = '11111111-1111-4111-8111-111111111111';
const user = { sub: 'staff-1' } as AuthenticatedUser;

describe('MeterController', () => {
  const service = {
    save: jest.fn().mockResolvedValue({ ok: true }),
    reconcile: jest.fn().mockResolvedValue({ ok: true }),
    history: jest.fn().mockResolvedValue([]),
  };
  const controller = new MeterController(service as unknown as MeterService);

  beforeEach(() => jest.clearAllMocks());

  describe('save', () => {
    it('passes the actor, date and body through, with the forwarded token', async () => {
      await controller.save(DEPOT, '2026-08-02', { openingM3: 1000 }, user, 'Bearer t');
      expect(service.save).toHaveBeenCalledWith({
        depotId: DEPOT,
        date: '2026-08-02',
        actorId: 'staff-1',
        authorization: 'Bearer t',
        openingM3: 1000,
      });
    });

    it('defaults a missing authorization header to empty rather than undefined', async () => {
      await controller.save(DEPOT, '2026-08-02', {}, user);
      expect(service.save.mock.calls[0][0].authorization).toBe('');
    });

    it('rejects a malformed date before it reaches a coercing Date', async () => {
      expect(() => controller.save(DEPOT, '02-08-2026', {}, user)).toThrow(BadRequestException);
      expect(() => controller.save(DEPOT, '2026-13-45', {}, user)).toThrow(BadRequestException);
      expect(service.save).not.toHaveBeenCalled();
    });
  });

  describe('reconcile', () => {
    it('delegates a valid day', async () => {
      await controller.reconcile(DEPOT, '2026-08-02');
      expect(service.reconcile).toHaveBeenCalledWith(DEPOT, '2026-08-02');
    });

    it('rejects a malformed day', () => {
      expect(() => controller.reconcile(DEPOT, 'yesterday')).toThrow(BadRequestException);
    });
  });

  describe('history', () => {
    it('defaults to the trailing 30 days when the window is open', async () => {
      await controller.history(DEPOT, {});
      const [, from, to] = service.history.mock.calls[0];
      expect(from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
      expect(days).toBe(29);
    });

    it('accepts an explicit window and trims an ISO timestamp to its day', async () => {
      await controller.history(DEPOT, { from: '2026-07-01T10:00:00.000Z', to: '2026-07-31' });
      expect(service.history).toHaveBeenCalledWith(DEPOT, '2026-07-01', '2026-07-31');
    });

    it('rejects a reversed window', () => {
      expect(() => controller.history(DEPOT, { from: '2026-07-31', to: '2026-07-01' })).toThrow(
        BadRequestException,
      );
    });

    it('rejects a window wider than the per-day scan budget', () => {
      expect(() => controller.history(DEPOT, { from: '2026-01-01', to: '2026-07-01' })).toThrow(
        BadRequestException,
      );
    });

    it('rejects a malformed bound', () => {
      expect(() => controller.history(DEPOT, { from: 'last-week', to: '2026-07-01' })).toThrow(
        BadRequestException,
      );
    });
  });
});
