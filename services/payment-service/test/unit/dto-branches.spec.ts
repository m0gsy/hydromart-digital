import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';

import {
  CashCollectedQueryDto,
  ConfirmPaymentDto,
  InitiatePaymentDto,
  ListPaymentsQueryDto,
} from '../../src/modules/dto/payment.dto';
import { TaxSettingsDto, UpdateTaxSettingsDto } from '../../src/modules/dto/tax-settings.dto';
import type { TaxSettingsRecord } from '../../src/application/ports/tax-settings.repository';

// Exercises the DTO transform callbacks (@Transform / @Type factories) and the
// TaxSettingsDto.from mapper — the code jest never runs unless a transform fires.

describe('CashCollectedQueryDto transform', () => {
  it('splits a comma string, trims, and drops blanks', () => {
    const dto = plainToInstance(CashCollectedQueryDto, {
      orderIds: 'a , b,, c ',
    });
    expect(dto.orderIds).toEqual(['a', 'b', 'c']);
  });

  it('passes a non-string value through unchanged (else branch)', () => {
    const dto = plainToInstance(CashCollectedQueryDto, {
      orderIds: ['x', 'y'],
    });
    expect(dto.orderIds).toEqual(['x', 'y']);
  });
});

describe('numeric @Type coercion', () => {
  it('coerces string numbers on the money/paging DTOs', () => {
    const init = plainToInstance(InitiatePaymentDto, {
      orderId: 'o1',
      method: 'CASH',
      amount: '45000',
    });
    expect(init.amount).toBe(45000);

    const list = plainToInstance(ListPaymentsQueryDto, { page: '2', limit: '10' });
    expect(list.page).toBe(2);
    expect(list.limit).toBe(10);

    const confirm = plainToInstance(ConfirmPaymentDto, { cashReceived: '50000' });
    expect(confirm.cashReceived).toBe(50000);

    const tax = plainToInstance(
      UpdateTaxSettingsDto,
      { ppnPercent: '11' } as unknown as UpdateTaxSettingsDto,
    );
    expect(tax.ppnPercent).toBe(11);
  });
});

describe('TaxSettingsDto.from', () => {
  const base: TaxSettingsRecord = {
    ppnPercent: 11,
    priceIncludesTax: true,
    invoiceFormat: 'INV',
    companyName: 'HM',
    npwp: '00',
    address: 'JKT',
    updatedAt: new Date('2026-03-04T05:06:07.000Z'),
  };

  it('serialises updatedAt to ISO when present', () => {
    const dto = TaxSettingsDto.from(base);
    expect(dto.updatedAt).toBe('2026-03-04T05:06:07.000Z');
    expect(dto.ppnPercent).toBe(11);
  });

  it('maps a null updatedAt to null', () => {
    const dto = TaxSettingsDto.from({ ...base, updatedAt: null });
    expect(dto.updatedAt).toBeNull();
  });
});
