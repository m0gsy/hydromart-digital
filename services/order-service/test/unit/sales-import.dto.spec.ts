import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import {
  ImportSalesTransactionRowDto,
  ImportSalesTransactionsDto,
  ListImportedSalesQueryDto,
  SummaryByMethodQueryDto,
} from '../../src/modules/dto/sales-import.dto';

const DEPOT_A = '11111111-1111-4111-8111-111111111111';

describe('ImportSalesTransactionRowDto', () => {
  const valid = {
    externalRef: 'INV-001',
    occurredAt: '2026-01-05T00:00:00.000Z',
    productLabel: 'Galon 19L',
    quantity: '2',
    unitPrice: '20000',
    lineTotal: '40000',
  };

  it('accepts a valid row and coerces numeric fields', async () => {
    const dto = plainToInstance(ImportSalesTransactionRowDto, valid);
    expect(await validate(dto)).toHaveLength(0);
    expect(dto).toMatchObject({ quantity: 2, unitPrice: 20000, lineTotal: 40000 });
  });

  it('accepts an optional customerLabel/paymentMethod and omits them when absent', async () => {
    const dto = plainToInstance(ImportSalesTransactionRowDto, {
      ...valid,
      customerLabel: 'Budi',
      paymentMethod: 'Tunai',
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects a non-positive quantity or price', async () => {
    const errors = await validate(
      plainToInstance(ImportSalesTransactionRowDto, { ...valid, quantity: '0', unitPrice: '-5' }),
    );
    expect(errors.map((e) => e.property).sort()).toEqual(['quantity', 'unitPrice']);
  });
});

describe('ImportSalesTransactionsDto', () => {
  it('caps rows at 500 and validates each nested row', async () => {
    const rows = Array.from({ length: 501 }, () => ({
      externalRef: 'x',
      occurredAt: '2026-01-01T00:00:00.000Z',
      productLabel: 'p',
      quantity: 1,
      unitPrice: 1,
      lineTotal: 1,
    }));
    const errors = await validate(
      plainToInstance(ImportSalesTransactionsDto, { depotId: DEPOT_A, rows }),
    );
    expect(errors.map((e) => e.property)).toContain('rows');
  });
});

describe('ListImportedSalesQueryDto', () => {
  it('requires depotId, from, and to', async () => {
    const errors = await validate(plainToInstance(ListImportedSalesQueryDto, {}));
    expect(errors.map((e) => e.property).sort()).toEqual(['depotId', 'from', 'to']);
  });

  it('accepts a complete query', async () => {
    const dto = plainToInstance(ListImportedSalesQueryDto, {
      depotId: DEPOT_A,
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-02-01T00:00:00.000Z',
    });
    expect(await validate(dto)).toHaveLength(0);
  });
});

describe('SummaryByMethodQueryDto', () => {
  it('has no required fields — an unbounded window is valid', async () => {
    expect(await validate(plainToInstance(SummaryByMethodQueryDto, {}))).toHaveLength(0);
  });

  it('rejects a malformed date when one is given', async () => {
    const errors = await validate(plainToInstance(SummaryByMethodQueryDto, { from: 'not-a-date' }));
    expect(errors.map((e) => e.property)).toEqual(['from']);
  });
});
