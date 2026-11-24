import { PendingApprovalsInternalController } from '../../src/modules/pending-approvals-internal.controller';

describe('PendingApprovalsInternalController', () => {
  it('hands the account and role to the shared service, nothing else', async () => {
    const forAccount = jest.fn().mockResolvedValue({ queues: [] });
    const ctrl = new PendingApprovalsInternalController({ forAccount } as never);
    await expect(ctrl.forAccount({ accountId: 'a-1', role: 'DIREKTUR' })).resolves.toEqual({ queues: [] });
    expect(forAccount).toHaveBeenCalledWith('a-1', 'DIREKTUR');
  });
});
