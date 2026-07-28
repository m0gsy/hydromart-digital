import { PayoutController } from '../../src/modules/payout.controller';
import { PayoutService } from '../../src/application/services/payout.service';
import { AuthenticatedUser } from '@hydromart/platform';
import {
  LedgerQueryDto,
  OrderRevenueDto,
  RequestWithdrawalDto,
} from '../../src/modules/dto/payout.dto';

describe('PayoutController', () => {
  const payout = {
    summary: jest.fn().mockResolvedValue({ balance: 0 }),
    ledgerPage: jest.fn().mockResolvedValue({ items: [] }),
    requestWithdrawal: jest.fn().mockResolvedValue({ id: 'w1' }),
    recordOrderRevenue: jest
      .fn()
      .mockResolvedValue({ recorded: true, revenue: 240000, commission: 12000, commissionPct: 5 }),
  };
  const controller = new PayoutController(payout as unknown as PayoutService);
  const user = { sub: 'owner-1' } as AuthenticatedUser;
  afterEach(() => jest.clearAllMocks());

  it('summary delegates with user.sub', async () => {
    await controller.summary(user);
    expect(payout.summary).toHaveBeenCalledWith('owner-1');
  });

  it('ledger delegates sub + page + limit', async () => {
    await controller.ledger(user, { page: 3, limit: 10 } as LedgerQueryDto);
    expect(payout.ledgerPage).toHaveBeenCalledWith('owner-1', 3, 10);
  });

  it('withdraw delegates sub + amount + bankAccountRef', async () => {
    await controller.withdraw(user, {
      amount: 8420000,
      bankAccountRef: 'BCA ···· 4821',
    } as RequestWithdrawalDto);
    expect(payout.requestWithdrawal).toHaveBeenCalledWith('owner-1', 8420000, 'BCA ···· 4821');
  });

  it('recordRevenue forwards every field of a full push', async () => {
    await controller.recordRevenue({
      orderId: 'o1',
      franchiseOwnerId: 'owner-1',
      depotId: 'depot-1',
      amountIdr: 240000,
      orderNumber: 'HM-1',
      completedAt: '2026-07-28T03:04:05.000Z',
    } as OrderRevenueDto);
    expect(payout.recordOrderRevenue).toHaveBeenCalledWith({
      orderId: 'o1',
      franchiseOwnerId: 'owner-1',
      depotId: 'depot-1',
      amountIdr: 240000,
      orderNumber: 'HM-1',
      occurredAt: new Date('2026-07-28T03:04:05.000Z'),
    });
  });

  it('recordRevenue nulls the optionals and leaves the timestamp to the service', async () => {
    await controller.recordRevenue({
      orderId: 'o2',
      franchiseOwnerId: 'owner-1',
      amountIdr: 50000,
    } as OrderRevenueDto);
    expect(payout.recordOrderRevenue).toHaveBeenCalledWith({
      orderId: 'o2',
      franchiseOwnerId: 'owner-1',
      depotId: null,
      amountIdr: 50000,
      orderNumber: null,
      occurredAt: undefined,
    });
  });
});
