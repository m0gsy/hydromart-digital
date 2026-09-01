import type { AuthenticatedUser } from '@hydromart/platform';

import { HqPayoutController } from '../../src/modules/hq-payout.controller';
import { CourierPayoutService } from '../../src/application/services/courier-payout.service';
import { PayoutService } from '../../src/application/services/payout.service';
import { ReleasePayoutDto, SettleWithdrawalDto } from '../../src/modules/dto/payout.dto';

const user = { sub: 'finance-1' } as AuthenticatedUser;

describe('HqPayoutController', () => {
  const payout = {
    pendingPayouts: jest.fn().mockResolvedValue([]),
    availableForOwner: jest.fn().mockResolvedValue({ balance: 0 }),
    releaseForOwner: jest.fn().mockResolvedValue({ id: 'w1' }),
    listProcessingWithdrawals: jest.fn().mockResolvedValue([]),
    settleWithdrawal: jest.fn().mockResolvedValue({ id: 'w1', status: 'PAID' }),
  };
  const courierPayout = {
    listProcessingWithdrawals: jest.fn().mockResolvedValue([]),
    settleWithdrawal: jest.fn().mockResolvedValue({ id: 'cw1', status: 'PAID' }),
  };
  const controller = new HqPayoutController(
    payout as unknown as PayoutService,
    courierPayout as unknown as CourierPayoutService,
  );
  afterEach(() => jest.clearAllMocks());

  it('pending delegates to pendingPayouts', async () => {
    await controller.pending();
    expect(payout.pendingPayouts).toHaveBeenCalledWith();
  });

  it('ownerBalance delegates with the ownerId param', async () => {
    await controller.ownerBalance('owner-9');
    expect(payout.availableForOwner).toHaveBeenCalledWith('owner-9');
  });

  it('release delegates with dto.franchiseOwnerId', async () => {
    await controller.release({ franchiseOwnerId: 'owner-9' } as ReleasePayoutDto);
    expect(payout.releaseForOwner).toHaveBeenCalledWith('owner-9');
  });

  /*
   * The six routes that give PROCESSING somewhere to go. Before them, `release` above wrote
   * a row that no code path could ever move on, while the ledger had already been debited.
   * The actor rides along on every settle: it is the only record of who answered for the
   * money, since there is no column for it.
   */
  it('reads both processing queues', async () => {
    await controller.processingWithdrawals();
    expect(payout.listProcessingWithdrawals).toHaveBeenCalledWith();
    await controller.processingCourierWithdrawals();
    expect(courierPayout.listProcessingWithdrawals).toHaveBeenCalledWith();
  });

  it('marks a franchise withdrawal PAID and FAILED, carrying the actor and the reason', async () => {
    await controller.markWithdrawalPaid(user, 'w-9');
    expect(payout.settleWithdrawal).toHaveBeenCalledWith('w-9', 'PAID', 'finance-1');

    await controller.markWithdrawalFailed(user, 'w-9', { reason: 'Rekening tutup' } as SettleWithdrawalDto);
    expect(payout.settleWithdrawal).toHaveBeenLastCalledWith(
      'w-9',
      'FAILED',
      'finance-1',
      'Rekening tutup',
    );
  });

  it('marks a courier withdrawal PAID and FAILED through the courier service', async () => {
    await controller.markCourierWithdrawalPaid(user, 'cw-9');
    expect(courierPayout.settleWithdrawal).toHaveBeenCalledWith('cw-9', 'PAID', 'finance-1');

    await controller.markCourierWithdrawalFailed(user, 'cw-9', {} as SettleWithdrawalDto);
    expect(courierPayout.settleWithdrawal).toHaveBeenLastCalledWith(
      'cw-9',
      'FAILED',
      'finance-1',
      undefined,
    );
  });
});
