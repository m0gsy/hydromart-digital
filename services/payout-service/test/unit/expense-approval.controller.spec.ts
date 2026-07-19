import { ExpenseApprovalController } from '../../src/modules/expense-approval.controller';
import { ExpenseClaimService } from '../../src/application/services/expense-claim.service';
import { AuthenticatedUser } from '@hydromart/platform';
import { ExpenseQueryDto, ReviewExpenseDto } from '../../src/modules/dto/expense-claim.dto';

describe('ExpenseApprovalController', () => {
  const expenses = {
    searchForDepot: jest.fn().mockResolvedValue({ items: [] }),
    approve: jest.fn().mockResolvedValue({ id: 'x1' }),
    reject: jest.fn().mockResolvedValue({ id: 'x1' }),
  };
  const controller = new ExpenseApprovalController(expenses as unknown as ExpenseClaimService);
  const user = { sub: 'reviewer-1' } as AuthenticatedUser;
  afterEach(() => jest.clearAllMocks());

  it('list maps provided depot + status filters', async () => {
    await controller.list({ depotId: 'd1', status: 'PENDING', page: 2, limit: 30 } as ExpenseQueryDto);
    expect(expenses.searchForDepot).toHaveBeenCalledWith('d1', 'PENDING', 2, 30);
  });

  it('list falls back to null for omitted depot + status', async () => {
    await controller.list({ page: 1, limit: 20 } as ExpenseQueryDto);
    expect(expenses.searchForDepot).toHaveBeenCalledWith(null, null, 1, 20);
  });

  it('approve delegates id + reviewer sub + note', async () => {
    await controller.approve('claim-1', user, { note: 'ok' } as ReviewExpenseDto);
    expect(expenses.approve).toHaveBeenCalledWith('claim-1', 'reviewer-1', 'ok');
  });

  it('reject delegates id + reviewer sub + note', async () => {
    await controller.reject('claim-1', user, { note: 'no' } as ReviewExpenseDto);
    expect(expenses.reject).toHaveBeenCalledWith('claim-1', 'reviewer-1', 'no');
  });
});
