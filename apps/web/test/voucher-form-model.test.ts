import { describe, expect, it } from 'vitest';

import {
  emptyVoucherForm,
  voucherFormFrom,
  voucherFormProblem,
  voucherFormToPayload,
  voucherState,
} from '@/lib/voucher-form';
import type { Voucher } from '@/lib/types';

const voucher = (o: Partial<Voucher> = {}): Voucher => ({
  id: 'v1',
  code: 'HEMAT10',
  description: null,
  discountType: 'PERCENTAGE',
  value: 10,
  minSpend: 0,
  maxDiscount: null,
  validFrom: null,
  validUntil: null,
  usageLimit: null,
  perCustomerLimit: 1,
  usedCount: 0,
  active: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...o,
});

/*
 * One form model for the three voucher screens. The two forms it replaces each missed what the
 * other had, and neither could say who may spend a code or where.
 */
describe('voucherFormProblem', () => {
  const ok = { ...emptyVoucherForm(), code: 'HEMAT10', value: '10' };

  it('refuses a code the server would refuse, before calling it', () => {
    expect(voucherFormProblem({ ...ok, code: '' }, 'create', false)).toBe('needCode');
    expect(voucherFormProblem({ ...ok, code: 'DUA20' }, 'create', false)).toBe('codeTooShort');
    // An edit never sends the code, so it is not checked.
    expect(voucherFormProblem({ ...ok, code: '' }, 'edit', false)).toBeNull();
  });

  it('checks the value, the scope and the dates', () => {
    expect(voucherFormProblem({ ...ok, value: '0' }, 'create', false)).toBe('needValue');
    expect(voucherFormProblem({ ...ok, value: '101' }, 'create', false)).toBe('percentTooHigh');
    expect(voucherFormProblem({ ...ok, productId: 'p', categoryId: 'c' }, 'create', false)).toBe('scopeBoth');
    expect(
      voucherFormProblem({ ...ok, validFrom: '2026-12-02', validUntil: '2026-12-01' }, 'create', false),
    ).toBe('endBeforeStart');
    expect(voucherFormProblem({ ...ok, discountType: 'FREE_SHIPPING', value: '' }, 'create', false)).toBeNull();
  });

  it('asks a depot-scoped author for a depot, and head office for none', () => {
    expect(voucherFormProblem(ok, 'create', true)).toBe('needDepot');
    expect(voucherFormProblem({ ...ok, depotId: 'd-1' }, 'create', true)).toBeNull();
    expect(voucherFormProblem(ok, 'create', false)).toBeNull();
  });
});

describe('voucherFormToPayload', () => {
  it('sends who, where, the budget and whole WIB days', () => {
    const payload = voucherFormToPayload(
      {
        ...emptyVoucherForm('d-1'),
        code: ' hemat10 ',
        value: '10',
        audience: 'GRANTED',
        budgetCap: '500000',
        validFrom: '2026-12-01',
        validUntil: '2026-12-31',
      },
      'create',
    );
    expect(payload).toMatchObject({
      code: 'HEMAT10',
      audience: 'GRANTED',
      depotId: 'd-1',
      budgetCap: 500000,
      validFrom: '2026-11-30T17:00:00.000Z',
      validUntil: '2026-12-31T16:59:59.999Z',
    });
  });

  it('sends no code on an edit, and the network as null', () => {
    const payload = voucherFormToPayload({ ...emptyVoucherForm(), value: '10' }, 'edit');
    expect(payload).not.toHaveProperty('code');
    expect(payload.depotId).toBeNull();
  });
});

describe('voucherFormFrom', () => {
  it("reads head office's 00:00 WIB start as that day, not the one before", () => {
    const form = voucherFormFrom(
      voucher({ validFrom: '2026-11-30T17:00:00.000Z', validUntil: '2026-12-31T16:59:59.999Z' }),
    );
    expect(form.validFrom).toBe('2026-12-01');
    expect(form.validUntil).toBe('2026-12-31');
  });

  it('keeps audience, depot and budget', () => {
    const form = voucherFormFrom(voucher({ audience: 'GRANTED', depotId: 'd-1', budgetCap: 100000 }));
    expect(form).toMatchObject({ audience: 'GRANTED', depotId: 'd-1', budgetCap: '100000' });
  });
});

describe('voucherState', () => {
  const now = new Date('2026-12-15T05:00:00.000Z');
  it('tells live, not started, ended and switched off apart', () => {
    expect(voucherState(voucher(), now)).toBe('active');
    expect(voucherState(voucher({ active: false }), now)).toBe('inactive');
    expect(voucherState(voucher({ validFrom: '2026-12-20T00:00:00.000Z' }), now)).toBe('upcoming');
    expect(voucherState(voucher({ validUntil: '2026-12-01T00:00:00.000Z' }), now)).toBe('expired');
  });
});
