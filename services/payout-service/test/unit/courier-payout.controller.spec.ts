import { CourierPayoutController } from '../../src/modules/courier-payout.controller';
import { CourierPayoutService } from '../../src/application/services/courier-payout.service';
import { ExpenseClaimService } from '../../src/application/services/expense-claim.service';
import { AuthenticatedUser } from '@hydromart/platform';
import {
  CashVarianceEventDto,
  CourierLedgerQueryDto,
  DeliveryCompletedEventDto,
} from '../../src/modules/dto/courier-payout.dto';
import { ExpenseQueryDto, SubmitExpenseDto } from '../../src/modules/dto/expense-claim.dto';
import { RequestWithdrawalDto } from '../../src/modules/dto/payout.dto';

describe('CourierPayoutController', () => {
  const payout = {
    summary: jest.fn().mockResolvedValue({ balance: 0 }),
    ledgerPage: jest.fn().mockResolvedValue({ items: [] }),
    requestWithdrawal: jest.fn().mockResolvedValue({ id: 'w1' }),
    withdrawalHistory: jest.fn().mockResolvedValue([]),
    recordDeliveryEarning: jest.fn(),
    recordCashVariance: jest.fn(),
    effectiveRule: jest.fn().mockResolvedValue(null),
  };
  const expenses = {
    submit: jest.fn().mockResolvedValue({ id: 'x1' }),
    listForCourier: jest.fn().mockResolvedValue({ items: [] }),
  };
  const controller = new CourierPayoutController(
    payout as unknown as CourierPayoutService,
    expenses as unknown as ExpenseClaimService,
  );
  const user = { sub: 'courier-1' } as AuthenticatedUser;
  afterEach(() => jest.clearAllMocks());

  it('summary delegates with user.sub', async () => {
    await controller.summary(user);
    expect(payout.summary).toHaveBeenCalledWith('courier-1');
  });

  it('earningRule delegates the depot from the token, null when unassigned', async () => {
    await controller.earningRule({ ...user, depotId: 'dep-1' } as AuthenticatedUser);
    expect(payout.effectiveRule).toHaveBeenCalledWith('dep-1');
    await controller.earningRule(user);
    expect(payout.effectiveRule).toHaveBeenLastCalledWith(null);
  });

  it('ledger delegates sub + page + limit', async () => {
    await controller.ledger(user, { page: 2, limit: 50 } as CourierLedgerQueryDto);
    expect(payout.ledgerPage).toHaveBeenCalledWith('courier-1', 2, 50);
  });

  it('withdraw delegates sub + amount + bankAccountRef', async () => {
    await controller.withdraw(user, { amount: 5000, bankAccountRef: 'BCA' } as RequestWithdrawalDto);
    expect(payout.requestWithdrawal).toHaveBeenCalledWith('courier-1', 5000, 'BCA');
  });

  it('withdrawals delegates with user.sub', async () => {
    await controller.withdrawals(user);
    expect(payout.withdrawalHistory).toHaveBeenCalledWith('courier-1');
  });

  it('submitExpense maps dto with provided optionals', async () => {
    await controller.submitExpense(user, {
      category: 'FUEL',
      amount: 25000,
      description: 'bensin',
      depotId: 'd1',
      receiptUrl: 'http://r',
    } as SubmitExpenseDto);
    expect(expenses.submit).toHaveBeenCalledWith('courier-1', {
      category: 'FUEL',
      amount: 25000,
      description: 'bensin',
      depotId: 'd1',
      receiptUrl: 'http://r',
    });
  });

  it('submitExpense falls back to null for omitted optionals', async () => {
    await controller.submitExpense(user, {
      category: 'OTHER',
      amount: 10000,
      description: 'x',
    } as SubmitExpenseDto);
    expect(expenses.submit).toHaveBeenCalledWith('courier-1', {
      category: 'OTHER',
      amount: 10000,
      description: 'x',
      depotId: null,
      receiptUrl: null,
    });
  });

  it('expenseHistory delegates sub + page + limit', async () => {
    await controller.expenseHistory(user, { page: 1, limit: 20 } as ExpenseQueryDto);
    expect(expenses.listForCourier).toHaveBeenCalledWith('courier-1', 1, 20);
  });

  it('recordEarning maps dto (depotId provided) and reports recorded=true', async () => {
    payout.recordDeliveryEarning.mockResolvedValueOnce({ id: 'e1' });
    const res = await controller.recordEarning({
      courierId: 'c1',
      depotId: 'd1',
      deliveryId: 'del1',
      deliveredAt: '2026-01-01',
      onTime: true,
    } as DeliveryCompletedEventDto);
    expect(payout.recordDeliveryEarning).toHaveBeenCalledWith({
      courierId: 'c1',
      depotId: 'd1',
      deliveryId: 'del1',
      deliveredAt: '2026-01-01',
      onTime: true,
    });
    expect(res).toEqual({ recorded: true });
  });

  it('recordEarning falls back to null depotId and reports recorded=false when null entry', async () => {
    payout.recordDeliveryEarning.mockResolvedValueOnce(null);
    const res = await controller.recordEarning({
      courierId: 'c1',
      deliveryId: 'del1',
      deliveredAt: '2026-01-01',
      onTime: false,
    } as DeliveryCompletedEventDto);
    expect(payout.recordDeliveryEarning).toHaveBeenCalledWith({
      courierId: 'c1',
      depotId: null,
      deliveryId: 'del1',
      deliveredAt: '2026-01-01',
      onTime: false,
    });
    expect(res).toEqual({ recorded: false });
  });

  it('recordVariance maps dto (depotId provided) and reports recorded=true', async () => {
    payout.recordCashVariance.mockResolvedValueOnce({ id: 'v1' });
    const res = await controller.recordVariance({
      courierId: 'c1',
      depotId: 'd1',
      settlementId: 's1',
      amount: 3000,
    } as CashVarianceEventDto);
    expect(payout.recordCashVariance).toHaveBeenCalledWith({
      courierId: 'c1',
      depotId: 'd1',
      settlementId: 's1',
      amount: 3000,
    });
    expect(res).toEqual({ recorded: true });
  });

  it('recordVariance falls back to null depotId and reports recorded=false when null entry', async () => {
    payout.recordCashVariance.mockResolvedValueOnce(null);
    const res = await controller.recordVariance({
      courierId: 'c1',
      settlementId: 's1',
      amount: 3000,
    } as CashVarianceEventDto);
    expect(payout.recordCashVariance).toHaveBeenCalledWith({
      courierId: 'c1',
      depotId: null,
      settlementId: 's1',
      amount: 3000,
    });
    expect(res).toEqual({ recorded: false });
  });
});
