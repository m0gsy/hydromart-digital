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
  const releases = {
    request: jest.fn().mockResolvedValue({ id: 'req-1', status: 'PENDING' }),
    listPending: jest.fn().mockResolvedValue([]),
    approve: jest.fn().mockResolvedValue({ id: 'req-1', status: 'APPROVED' }),
    reject: jest.fn().mockResolvedValue({ id: 'req-1', status: 'REJECTED' }),
  };
  const controller = new HqPayoutController(
    payout as unknown as PayoutService,
    courierPayout as unknown as CourierPayoutService,
    releases as never,
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

  /*
   * PYO-2 (owner decision 2026-09-17): the release route asks; it no longer pays. The
   * destination still travels with the request — undefined means "the account the owner was
   * last paid to", not the literal string this route once recorded.
   */
  it('release only REQUESTS, carrying the destination and the requester', async () => {
    await controller.release(user, { franchiseOwnerId: 'owner-9' } as ReleasePayoutDto);
    expect(releases.request).toHaveBeenCalledWith('owner-9', undefined, 'finance-1');
    expect(payout.releaseForOwner).not.toHaveBeenCalled();

    await controller.release(user, {
      franchiseOwnerId: 'owner-9',
      bankAccountRef: 'BCA ···· 4821',
    } as ReleasePayoutDto);
    expect(releases.request).toHaveBeenLastCalledWith('owner-9', 'BCA ···· 4821', 'finance-1');
  });

  it('lists, approves and rejects release requests with the deciding actor', async () => {
    const approver = { sub: 'direktur-1' } as AuthenticatedUser;
    await controller.releaseRequests();
    expect(releases.listPending).toHaveBeenCalledWith();
    await controller.approveRelease(approver, 'req-1');
    expect(releases.approve).toHaveBeenCalledWith('req-1', 'direktur-1');
    await controller.rejectRelease(approver, 'req-1', { reason: 'rekening salah' });
    expect(releases.reject).toHaveBeenCalledWith('req-1', 'direktur-1', 'rekening salah');
    await controller.rejectRelease(approver, 'req-1', {});
    expect(releases.reject).toHaveBeenLastCalledWith('req-1', 'direktur-1', null);
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

    await controller.markWithdrawalFailed(user, 'w-9', {
      reason: 'Rekening tutup',
    } as SettleWithdrawalDto);
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
