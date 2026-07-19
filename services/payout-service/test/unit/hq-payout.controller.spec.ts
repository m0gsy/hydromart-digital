import { HqPayoutController } from '../../src/modules/hq-payout.controller';
import { PayoutService } from '../../src/application/services/payout.service';
import { ReleasePayoutDto } from '../../src/modules/dto/payout.dto';

describe('HqPayoutController', () => {
  const payout = {
    pendingPayouts: jest.fn().mockResolvedValue([]),
    availableForOwner: jest.fn().mockResolvedValue({ balance: 0 }),
    releaseForOwner: jest.fn().mockResolvedValue({ id: 'w1' }),
  };
  const controller = new HqPayoutController(payout as unknown as PayoutService);
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
});
