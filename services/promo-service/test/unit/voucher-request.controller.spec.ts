import { plainToInstance } from 'class-transformer';

import {
  DepotVoucherRequestController,
  VoucherRequestController,
} from '../../src/modules/voucher-request.controller';
import {
  ListVoucherRequestsQueryDto,
  ProposeVoucherRequestDto,
} from '../../src/modules/dto/voucher-request.dto';
import { VoucherRequestService } from '../../src/application/services/voucher-request.service';
import { VoucherRequestStatus } from '../../src/domain/voucher-request';
import { AuthenticatedUser } from '@hydromart/platform';

const user = { sub: 'user-1' } as AuthenticatedUser;

describe('DepotVoucherRequestController', () => {
  const requests = { propose: jest.fn().mockResolvedValue({ id: 'r1' }) };
  const controller = new DepotVoucherRequestController(
    requests as unknown as VoucherRequestService,
  );

  afterEach(() => jest.clearAllMocks());

  it('propose maps full dto with the depot and requester', async () => {
    await controller.propose(user, 'depot-1', {
      depotName: 'Depot A',
      code: 'HEMAT',
      description: 'desc',
      discountType: 'PERCENT',
      value: 10,
      minSpend: 50000,
      maxDiscount: 20000,
      usageLimit: 100,
      perCustomerLimit: 3,
      note: 'please',
    } as unknown as ProposeVoucherRequestDto);
    expect(requests.propose).toHaveBeenCalledWith('depot-1', 'user-1', {
      depotName: 'Depot A',
      code: 'HEMAT',
      description: 'desc',
      discountType: 'PERCENT',
      value: 10,
      minSpend: 50000,
      maxDiscount: 20000,
      usageLimit: 100,
      perCustomerLimit: 3,
      note: 'please',
    });
  });

  it('propose applies fallbacks for omitted optional fields', async () => {
    await controller.propose(user, 'depot-2', {
      depotName: 'Depot B',
      code: 'X',
      discountType: 'FIXED',
      value: 5000,
    } as unknown as ProposeVoucherRequestDto);
    expect(requests.propose).toHaveBeenCalledWith('depot-2', 'user-1', {
      depotName: 'Depot B',
      code: 'X',
      description: null,
      discountType: 'FIXED',
      value: 5000,
      minSpend: 0,
      maxDiscount: null,
      usageLimit: null,
      perCustomerLimit: 1,
      note: null,
    });
  });
});

describe('VoucherRequestController', () => {
  const requests = {
    list: jest.fn().mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 }),
    approve: jest.fn().mockResolvedValue({ id: 'r1', status: 'APPROVED' }),
    reject: jest.fn().mockResolvedValue({ id: 'r1', status: 'REJECTED' }),
  };
  const controller = new VoucherRequestController(requests as unknown as VoucherRequestService);

  afterEach(() => jest.clearAllMocks());

  it('list defaults page/limit/status to the pending queue', async () => {
    await controller.list({} as unknown as ListVoucherRequestsQueryDto);
    expect(requests.list).toHaveBeenCalledWith({
      page: 1,
      limit: 20,
      status: VoucherRequestStatus.PENDING,
    });
  });

  it('list passes explicit query params through', async () => {
    await controller.list({
      page: 3,
      limit: 5,
      status: VoucherRequestStatus.APPROVED,
    } as unknown as ListVoucherRequestsQueryDto);
    expect(requests.list).toHaveBeenCalledWith({
      page: 3,
      limit: 5,
      status: VoucherRequestStatus.APPROVED,
    });
  });

  it('approve delegates with id and approver', async () => {
    await controller.approve(user, 'req-1');
    expect(requests.approve).toHaveBeenCalledWith('req-1', 'user-1');
  });

  it('reject delegates with id and approver', async () => {
    await controller.reject(user, 'req-2');
    expect(requests.reject).toHaveBeenCalledWith('req-2', 'user-1');
  });
});

describe('Voucher-request DTO @Type coercion', () => {
  it('coerces numeric string inputs to numbers', () => {
    const propose = plainToInstance(ProposeVoucherRequestDto, {
      depotName: 'D',
      code: 'X',
      discountType: 'FIXED',
      value: '5000',
      minSpend: '1000',
      maxDiscount: '2000',
      usageLimit: '10',
      perCustomerLimit: '2',
    });
    expect(propose.value).toBe(5000);
    expect(propose.minSpend).toBe(1000);
    expect(propose.maxDiscount).toBe(2000);
    expect(propose.usageLimit).toBe(10);
    expect(propose.perCustomerLimit).toBe(2);

    const query = plainToInstance(ListVoucherRequestsQueryDto, { page: '3', limit: '5' });
    expect(query.page).toBe(3);
    expect(query.limit).toBe(5);
  });
});
