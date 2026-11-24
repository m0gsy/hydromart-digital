import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { PendingForAccountQueryDto } from '../../src/modules/dto/pending-approvals.dto';
import { PendingApprovalsInternalController } from '../../src/modules/pending-approvals-internal.controller';

describe('PendingApprovalsInternalController', () => {
  it('hands the account and role to the shared service, nothing else', async () => {
    const forAccount = jest.fn().mockResolvedValue({ queues: [] });
    const ctrl = new PendingApprovalsInternalController({ forAccount } as never);
    await expect(ctrl.forAccount({ accountId: 'a-1', role: 'DIREKTUR' })).resolves.toEqual({ queues: [] });
    expect(forAccount).toHaveBeenCalledWith('a-1', 'DIREKTUR');
  });
});

describe('PendingForAccountQueryDto', () => {
  const errors = async (plain: Record<string, unknown>) =>
    (await validate(plainToInstance(PendingForAccountQueryDto, plain))).map((e) => e.property);
  const ID = '99999999-9999-4999-8999-999999999999';

  it('takes a built-in role and an account id, nothing looser', async () => {
    expect(await errors({ accountId: ID, role: 'DIREKTUR' })).toEqual([]);
    expect(await errors({ accountId: ID, role: 'NOT_A_ROLE' })).toEqual(['role']);
    expect(await errors({ accountId: 'x', role: 'DIREKTUR' })).toEqual(['accountId']);
  });
});
