import { ReferralController } from '../../src/modules/referral.controller';
import { ReferralService } from '../../src/application/services/referral.service';
import { ReferralStatus } from '../../src/domain/referral-status';
import { AuthenticatedUser } from '@hydromart/platform';

// Delegate-assert the controller: importing it also covers its DTO mapping. Each method is
// called against a mocked ReferralService, asserting the delegation + DTO shape the e2e
// specs' full HTTP stack doesn't isolate. No Nest container, no HTTP.

const codeRecord = { id: 'c1', customerId: 'u1', code: 'BUDI10', createdAt: new Date('2026-01-01') };
const referralRecord = {
  id: 'ref-1',
  referrerCustomerId: 'u1',
  refereeCustomerId: 'u2',
  code: 'BUDI10',
  status: ReferralStatus.PENDING,
  qualifyingOrderId: null,
  referrerPoints: 0,
  refereePoints: 0,
  qualifiedAt: null,
  createdAt: new Date('2026-01-01'),
};
const summary = {
  code: codeRecord,
  referrals: { items: [referralRecord], total: 1, page: 1, limit: 20, totalPages: 1 },
  referredCount: 1,
  qualifiedCount: 0,
  pointsEarned: 0,
};
const depotSummary = {
  depotId: 'd1',
  invited: 5,
  qualified: 2,
  conversionPct: 40,
  pointsAwarded: 1000,
  topReferrers: [],
};

const user = { sub: 'u1' } as AuthenticatedUser;

function makeController() {
  const service = {
    getOrCreateMyCode: jest.fn().mockResolvedValue(codeRecord),
    getMySummary: jest.fn().mockResolvedValue(summary),
    getCustomerSummary: jest.fn().mockResolvedValue(summary),
    redeem: jest.fn().mockResolvedValue(referralRecord),
    qualify: jest.fn().mockResolvedValue({ qualified: true, referral: referralRecord }),
    depotSummary: jest.fn().mockResolvedValue(depotSummary),
  } as unknown as jest.Mocked<ReferralService>;
  return { controller: new ReferralController(service), service };
}

describe('ReferralController', () => {
  it('myCode returns the current customer code', async () => {
    const { controller, service } = makeController();
    const out = await controller.myCode(user);
    expect(service.getOrCreateMyCode).toHaveBeenCalledWith('u1');
    expect(out.code).toBe('BUDI10');
  });

  it('mySummary passes page/limit through to the service', async () => {
    const { controller, service } = makeController();
    const out = await controller.mySummary(user, { page: 2, limit: 5 });
    expect(service.getMySummary).toHaveBeenCalledWith('u1', 2, 5);
    expect(out.referredCount).toBe(1);
  });

  it('redeem delegates the normalised code', async () => {
    const { controller, service } = makeController();
    const out = await controller.redeem(user, { code: 'budi10' });
    expect(service.redeem).toHaveBeenCalledWith('u1', 'budi10');
    expect(out.id).toBe('ref-1');
  });

  it('qualify delegates the internal payload with an empty authorization', () => {
    const { controller, service } = makeController();
    controller.qualify({ customerId: 'u2', orderId: 'ord-1' });
    expect(service.qualify).toHaveBeenCalledWith('u2', 'ord-1', '');
  });

  it('depotSummary maps the aggregate DTO', async () => {
    const { controller, service } = makeController();
    const out = await controller.depotSummary({ depotId: 'd1' });
    expect(service.depotSummary).toHaveBeenCalledWith('d1');
    expect(out).toMatchObject({ invited: 5, qualified: 2, conversionPct: 40 });
  });

  it('byCustomer reads a summary for an arbitrary customer', async () => {
    const { controller, service } = makeController();
    const out = await controller.byCustomer('u9', { page: 1, limit: 20 });
    expect(service.getCustomerSummary).toHaveBeenCalledWith('u9', 1, 20);
    expect(out.qualifiedCount).toBe(0);
  });
});
