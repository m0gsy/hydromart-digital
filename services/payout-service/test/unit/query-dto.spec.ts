import { ClassConstructor, plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import {
  CashVarianceEventDto,
  CourierLedgerQueryDto,
  DeliveryCompletedEventDto,
} from '../../src/modules/dto/courier-payout.dto';
import { ExpenseQueryDto } from '../../src/modules/dto/expense-claim.dto';
import { CommissionByDepotQueryDto, LedgerQueryDto } from '../../src/modules/dto/payout.dto';

interface PageDto {
  page: number;
  limit: number;
}

// Pagination query DTOs carry class defaults + a Number transform; instantiate them so
// those default/transform lines are exercised (and locked to sane bounds).
describe.each<[string, ClassConstructor<PageDto>]>([
  ['LedgerQueryDto', LedgerQueryDto],
  ['CourierLedgerQueryDto', CourierLedgerQueryDto],
  ['ExpenseQueryDto', ExpenseQueryDto],
])('%s pagination', (_name, Cls) => {
  it('defaults page=1 and limit=20 when omitted', () => {
    const dto = plainToInstance(Cls, {});
    expect(dto.page).toBe(1);
    expect(dto.limit).toBe(20);
    expect(validateSync(dto)).toEqual([]);
  });

  it('coerces numeric strings and validates in range', () => {
    const dto = plainToInstance(Cls, { page: '2', limit: '50' });
    expect(dto.page).toBe(2);
    expect(dto.limit).toBe(50);
    expect(validateSync(dto)).toEqual([]);
  });

  it('rejects out-of-range limit', () => {
    const dto = plainToInstance(Cls, { limit: '500' });
    expect(validateSync(dto).map((e) => e.property)).toContain('limit');
  });
});

describe('DeliveryCompletedEventDto', () => {
  const valid = {
    courierId: '11111111-1111-4111-8111-111111111111',
    deliveryId: '22222222-2222-4222-8222-222222222222',
    deliveredAt: '2026-01-01T00:00:00.000Z',
    onTime: true,
  };
  it('accepts a well-formed event (depotId optional)', () => {
    expect(validateSync(plainToInstance(DeliveryCompletedEventDto, valid))).toEqual([]);
  });
  it('rejects a non-boolean onTime', () => {
    const errs = validateSync(
      plainToInstance(DeliveryCompletedEventDto, { ...valid, onTime: 'yes' }),
    );
    expect(errs.map((e) => e.property)).toContain('onTime');
  });
});

describe('CashVarianceEventDto', () => {
  const valid = {
    courierId: '11111111-1111-4111-8111-111111111111',
    settlementId: '33333333-3333-4333-8333-333333333333',
    amount: 3000,
  };
  it('accepts a positive integer amount', () => {
    expect(validateSync(plainToInstance(CashVarianceEventDto, valid))).toEqual([]);
  });
  it('rejects a non-positive amount', () => {
    const errs = validateSync(plainToInstance(CashVarianceEventDto, { ...valid, amount: 0 }));
    expect(errs.map((e) => e.property)).toContain('amount');
  });
});

describe('CommissionByDepotQueryDto (HD-6 H5)', () => {
  const D = '11111111-1111-4111-8111-111111111111';
  const ok = (body: object) => validateSync(plainToInstance(CommissionByDepotQueryDto, body));
  it('takes comma-separated depot ids and an ordered window of at most a leap year', () => {
    const dto = plainToInstance(CommissionByDepotQueryDto, { depotIds: ` ${D}, ${D}`, from: '2026-11-01T00:00:00Z', to: '2026-12-01T00:00:00Z' });
    expect(dto.depotIds).toEqual([D, D]);
    expect(validateSync(dto)).toEqual([]);
    expect(ok({ depotIds: '', from: '2026-11-01T00:00:00Z', to: '2026-12-01T00:00:00Z' })).not.toEqual([]);
    expect(ok({ depotIds: 'x', from: '2026-11-01T00:00:00Z', to: '2026-12-01T00:00:00Z' })).not.toEqual([]);
    expect(ok({ depotIds: D, from: '2026-12-01T00:00:00Z', to: '2026-11-01T00:00:00Z' })).not.toEqual([]);
    expect(ok({ depotIds: D, from: '2020-01-01T00:00:00Z', to: '2026-11-01T00:00:00Z' })).not.toEqual([]);
  });
});
