import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { CreateCategoryDto } from '../../src/modules/dto/category.dto';
import { BrowseProductsQueryDto, CreateProductDto } from '../../src/modules/dto/product.dto';

describe('DTO @Type(() => Number) coercion', () => {
  it('coerces page and limit query strings to numbers', () => {
    const dto = plainToInstance(BrowseProductsQueryDto, { page: '3', limit: '25' });
    expect(dto.page).toBe(3);
    expect(dto.limit).toBe(25);
  });

  it('coerces basePrice string to a number', () => {
    const dto = plainToInstance(CreateProductDto, { basePrice: '20000' });
    expect(dto.basePrice).toBe(20000);
  });

  it('coerces category sortOrder string to a number', () => {
    const dto = plainToInstance(CreateCategoryDto, { sortOrder: '5' });
    expect(dto.sortOrder).toBe(5);
  });
});

/*
 * A8 — a price nobody can pay must not be storable.
 *
 * The column is `Decimal(12,2)` and this DTO only asked for positive, so `19999.5` was
 * accepted and stored: measured against the running stack, 201 with `basePrice: 19999.5`
 * echoed back. Downstream it left the cart with a fractional subtotal, and the voucher
 * quote's `@IsInt()` turns that into a 400 the checkout screen renders as "voucher tidak
 * valid" — a catalog defect wearing a promo error's clothes.
 */
describe('CreateProductDto basePrice is whole rupiah', () => {
  const base = {
    categoryId: '11111111-2222-4333-8444-555555555555',
    sku: 'A8-CHECK',
    name: 'Uji',
    unit: 'Botol',
  };
  const errorsFor = (basePrice: unknown): string[] =>
    validateSync(plainToInstance(CreateProductDto, { ...base, basePrice }))
      .filter((e) => e.property === 'basePrice')
      .flatMap((e) => Object.keys(e.constraints ?? {}));

  it('rejects a fractional price', () => {
    expect(errorsFor(19999.5)).toContain('isInt');
  });

  it('rejects a fractional price that arrived as a string', () => {
    // The form posts strings; `@Type(() => Number)` coerces before validation, so the
    // guard has to survive that hop or it only ever protects the JSON callers.
    expect(errorsFor('19999.5')).toContain('isInt');
  });

  it('still accepts a whole one', () => {
    expect(errorsFor(20000)).toHaveLength(0);
  });
});
