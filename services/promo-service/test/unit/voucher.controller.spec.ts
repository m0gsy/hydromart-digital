import { plainToInstance } from 'class-transformer';

import { VoucherController } from '../../src/modules/voucher.controller';
import { VoucherService } from '../../src/application/services/voucher.service';
import {
  BrowseQueryDto,
  CreateVoucherDto,
  GrantVoucherDto,
  QuoteVoucherDto,
  RedeemVoucherDto,
  UpdateVoucherDto,
} from '../../src/modules/dto/voucher.dto';
import { AuthenticatedUser } from '@hydromart/platform';

const user = { sub: 'user-1' } as AuthenticatedUser;

describe('VoucherController', () => {
  const vouchers = {
    browse: jest.fn().mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 }),
    burnSummary: jest.fn().mockResolvedValue({ totalUsed: 0, byVoucher: {} }),
    myVouchers: jest.fn(),
    quote: jest.fn().mockResolvedValue({ discount: 1000 }),
    redeem: jest.fn().mockResolvedValue({ discount: 1000, usageId: 'u1' }),
    create: jest.fn().mockResolvedValue({ id: 'v1' }),
    grant: jest.fn().mockResolvedValue({ voucher: { id: 'v1' }, granted: true }),
    update: jest.fn().mockResolvedValue({ id: 'v1' }),
    deactivate: jest.fn().mockResolvedValue({ id: 'v1', active: false }),
    getByCode: jest.fn().mockResolvedValue({ id: 'v1', code: 'HEMAT' }),
  };
  const controller = new VoucherController(vouchers as unknown as VoucherService);

  afterEach(() => jest.clearAllMocks());

  it('browse delegates page/limit and forces includeInactive=false', async () => {
    await controller.browse({ page: 2, limit: 10 } as unknown as BrowseQueryDto);
    expect(vouchers.browse).toHaveBeenCalledWith(2, 10, false);
  });

  it('burnSummary delegates', async () => {
    await controller.burnSummary();
    expect(vouchers.burnSummary).toHaveBeenCalled();
  });

  it('myVouchers maps the wallet through MyVoucherDto.from', async () => {
    vouchers.myVouchers.mockResolvedValue([
      {
        status: 'ACTIVE',
        voucher: {
          code: 'HEMAT',
          description: 'desc',
          discountType: 'PERCENT',
          value: 10,
          minSpend: 50000,
          maxDiscount: 20000,
          validUntil: new Date('2026-02-01T00:00:00.000Z'),
        },
      },
    ]);
    const result = await controller.myVouchers(user);
    expect(vouchers.myVouchers).toHaveBeenCalledWith('user-1');
    expect(result).toEqual([
      {
        code: 'HEMAT',
        description: 'desc',
        discountType: 'PERCENT',
        value: 10,
        minSpend: 50000,
        maxDiscount: 20000,
        validUntil: new Date('2026-02-01T00:00:00.000Z'),
        status: 'ACTIVE',
      },
    ]);
  });

  it('quote passes the shippingFee through when provided', async () => {
    await controller.quote(user, {
      code: 'HEMAT',
      subtotal: 100000,
      shippingFee: 5000,
    } as unknown as QuoteVoucherDto);
    expect(vouchers.quote).toHaveBeenCalledWith('HEMAT', 'user-1', 100000, 5000);
  });

  it('quote defaults shippingFee to 0 when omitted', async () => {
    await controller.quote(user, {
      code: 'HEMAT',
      subtotal: 100000,
    } as unknown as QuoteVoucherDto);
    expect(vouchers.quote).toHaveBeenCalledWith('HEMAT', 'user-1', 100000, 0);
  });

  it('redeem passes the shippingFee through when provided', async () => {
    await controller.redeem({
      code: 'HEMAT',
      customerId: 'c1',
      orderId: 'o1',
      subtotal: 100000,
      shippingFee: 5000,
    } as unknown as RedeemVoucherDto);
    expect(vouchers.redeem).toHaveBeenCalledWith('HEMAT', 'c1', 'o1', 100000, 5000);
  });

  it('redeem defaults shippingFee to 0 when omitted', async () => {
    await controller.redeem({
      code: 'HEMAT',
      customerId: 'c1',
      orderId: 'o1',
      subtotal: 100000,
    } as unknown as RedeemVoucherDto);
    expect(vouchers.redeem).toHaveBeenCalledWith('HEMAT', 'c1', 'o1', 100000, 0);
  });

  it('create maps full dto and parses dates', async () => {
    await controller.create({
      code: 'HEMAT',
      description: 'desc',
      discountType: 'PERCENT',
      value: 10,
      minSpend: 50000,
      maxDiscount: 20000,
      validFrom: '2026-01-01T00:00:00.000Z',
      validUntil: '2026-02-01T00:00:00.000Z',
      usageLimit: 100,
      perCustomerLimit: 3,
      budgetCap: 1000000,
      active: true,
    } as unknown as CreateVoucherDto);
    expect(vouchers.create).toHaveBeenCalledWith({
      code: 'HEMAT',
      description: 'desc',
      discountType: 'PERCENT',
      value: 10,
      minSpend: 50000,
      maxDiscount: 20000,
      validFrom: new Date('2026-01-01T00:00:00.000Z'),
      validUntil: new Date('2026-02-01T00:00:00.000Z'),
      usageLimit: 100,
      perCustomerLimit: 3,
      budgetCap: 1000000,
      active: true,
    });
  });

  it('create applies null/zero/default fallbacks for omitted optional fields', async () => {
    await controller.create({
      code: 'BARE',
      discountType: 'FIXED',
      value: 5000,
      active: false,
    } as unknown as CreateVoucherDto);
    expect(vouchers.create).toHaveBeenCalledWith({
      code: 'BARE',
      description: null,
      discountType: 'FIXED',
      value: 5000,
      minSpend: 0,
      maxDiscount: null,
      validFrom: null,
      validUntil: null,
      usageLimit: null,
      perCustomerLimit: 1,
      budgetCap: null,
      active: false,
    });
  });

  it('grant forwards the authorization header when present', async () => {
    await controller.grant('v1', { customerId: 'c1' } as unknown as GrantVoucherDto, 'Bearer tok');
    expect(vouchers.grant).toHaveBeenCalledWith('v1', 'c1', 'Bearer tok');
  });

  it('grant defaults authorization to empty string when absent', async () => {
    await controller.grant('v1', { customerId: 'c1' } as unknown as GrantVoucherDto, undefined);
    expect(vouchers.grant).toHaveBeenCalledWith('v1', 'c1', '');
  });

  it('update maps patch and parses provided dates', async () => {
    await controller.update('v1', {
      description: 'new',
      value: 15,
      validFrom: '2026-03-01T00:00:00.000Z',
    } as unknown as UpdateVoucherDto);
    expect(vouchers.update).toHaveBeenCalledWith('v1', {
      description: 'new',
      discountType: undefined,
      value: 15,
      minSpend: undefined,
      maxDiscount: undefined,
      validFrom: new Date('2026-03-01T00:00:00.000Z'),
      validUntil: undefined,
      usageLimit: undefined,
      perCustomerLimit: undefined,
      active: undefined,
    });
  });

  it('deactivate delegates with the id', async () => {
    await controller.deactivate('v1');
    expect(vouchers.deactivate).toHaveBeenCalledWith('v1');
  });

  it('getByCode delegates with the code', async () => {
    await controller.getByCode('HEMAT');
    expect(vouchers.getByCode).toHaveBeenCalledWith('HEMAT');
  });
});

describe('Voucher DTO @Type coercion', () => {
  it('coerces numeric string inputs to numbers', () => {
    const create = plainToInstance(CreateVoucherDto, {
      code: 'HEMAT',
      discountType: 'FIXED',
      value: '5000',
      minSpend: '1000',
      maxDiscount: '2000',
      usageLimit: '10',
      perCustomerLimit: '2',
      budgetCap: '9000',
    });
    expect(create.value).toBe(5000);
    expect(create.minSpend).toBe(1000);
    expect(create.maxDiscount).toBe(2000);
    expect(create.usageLimit).toBe(10);
    expect(create.perCustomerLimit).toBe(2);
    expect(create.budgetCap).toBe(9000);

    const quote = plainToInstance(QuoteVoucherDto, { code: 'X', subtotal: '100000', shippingFee: '5000' });
    expect(quote.subtotal).toBe(100000);
    expect(quote.shippingFee).toBe(5000);

    const redeem = plainToInstance(RedeemVoucherDto, {
      code: 'X',
      customerId: 'c1',
      orderId: 'o1',
      subtotal: '100000',
      shippingFee: '5000',
    });
    expect(redeem.subtotal).toBe(100000);

    const update = plainToInstance(UpdateVoucherDto, { value: '15', minSpend: '2000' });
    expect(update.value).toBe(15);

    const browse = plainToInstance(BrowseQueryDto, { page: '2', limit: '10' });
    expect(browse.page).toBe(2);
    expect(browse.limit).toBe(10);
  });
});
