import {
  BadRequestException,
  ForbiddenException,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from '@nestjs/common';

import { AuthenticatedUser, Role } from '@hydromart/platform';

import { ApprovalController } from '../../src/modules/approval.controller';
import { CashbookController } from '../../src/modules/cashbook.controller';
import { CashierShiftController } from '../../src/modules/cashier-shift.controller';
import { DisputeController } from '../../src/modules/dispute.controller';
import { DepotTargetController } from '../../src/modules/depot-target.controller';
import { DepotController } from '../../src/modules/depot.controller';
import { DriverGallonReturnController } from '../../src/modules/driver-gallon-return.controller';
import { FranchiseApplicationController } from '../../src/modules/franchise-application.controller';
import { GallonIssueController } from '../../src/modules/gallon-issue.controller';
import { GallonNetworkController } from '../../src/modules/gallon-network.controller';
import { GallonReturnController } from '../../src/modules/gallon-return.controller';
import { HandoverController } from '../../src/modules/handover.controller';
import { HierarchyController } from '../../src/modules/hierarchy.controller';
import { HuddleController } from '../../src/modules/huddle.controller';
import { IncidentController } from '../../src/modules/incident.controller';
import {
  DepotInventoryController,
  InventoryController,
} from '../../src/modules/inventory.controller';
import { MaintenanceController } from '../../src/modules/maintenance.controller';
import {
  DepotPriceOverrideController,
  PriceOverrideController,
} from '../../src/modules/price-override.controller';
import { PricingController } from '../../src/modules/pricing.controller';
import { PurchaseOrderController } from '../../src/modules/purchase-order.controller';
import { RosterController } from '../../src/modules/roster.controller';
import { SubscriptionController } from '../../src/modules/subscription.controller';
import { SupplierController } from '../../src/modules/supplier.controller';
import { WholesaleTierController } from '../../src/modules/wholesale-tier.controller';

// Delegate-assert coverage for every thin depot-service controller: each handler forwards to
// its application service and applies the small ?? default / new Date() branches. Fakes are
// plain jest.fn() objects; a non-depot-locked user makes assertDepotAccess/Ownership a no-op.

const DEPOT = '11111111-1111-4111-8111-111111111111';
const ID = '22222222-2222-4222-8222-222222222222';
const user = { sub: 'user-1', role: Role.SUPER_ADMIN, depotId: null } as AuthenticatedUser;
const ISO = '2026-07-01T00:00:00.000Z';

describe('ApprovalController', () => {
  const svc = {
    create: jest.fn(),
    list: jest.fn(),
    counts: jest.fn(),
    get: jest.fn(),
    decide: jest.fn(),
  };
  const c = new ApprovalController(svc as never);
  beforeEach(() => {
    jest.clearAllMocks();
    svc.get.mockResolvedValue({ depotId: DEPOT });
  });

  it('creates with and without optional subjectRef', async () => {
    await c.create(
      { depotId: DEPOT, type: 'T', title: 'x', amountIdr: 1, payload: {} } as never,
      user,
    );
    expect(svc.create).toHaveBeenCalledWith(
      expect.objectContaining({ subjectRef: null }),
      'user-1',
    );
    await c.create(
      {
        depotId: DEPOT,
        type: 'T',
        title: 'x',
        subjectRef: 'r',
        amountIdr: 1,
        payload: {},
      } as never,
      user,
    );
    expect(svc.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ subjectRef: 'r' }),
      'user-1',
    );
  });

  it('lists, counts, gets and decides', async () => {
    await c.list({ depotId: DEPOT, status: 'PENDING' } as never);
    expect(svc.list).toHaveBeenCalledWith(DEPOT, 'PENDING');
    await c.counts({ depotId: DEPOT } as never);
    expect(svc.counts).toHaveBeenCalledWith(DEPOT);
    await c.get(ID, user);
    expect(svc.get).toHaveBeenCalledWith(ID);
    await c.decide(ID, { decision: 'APPROVE' } as never, user);
    expect(svc.decide).toHaveBeenLastCalledWith(ID, 'APPROVE', null, 'user-1');
    await c.decide(ID, { decision: 'HOLD', note: 'n' } as never, user);
    expect(svc.decide).toHaveBeenLastCalledWith(ID, 'HOLD', 'n', 'user-1');
  });
});

describe('CashierShiftController', () => {
  const svc = { open: jest.fn(), current: jest.fn(), list: jest.fn(), close: jest.fn() };
  const c = new CashierShiftController(svc as never);
  beforeEach(() => jest.clearAllMocks());

  // The token has no display name, so the shift row records the phone — the identifier a
  // depot will still recognise months later when the drawer is questioned.
  it('opens under the caller phone, falling back to their id', async () => {
    await c.open({ depotId: DEPOT, openingFloat: 100 } as never, {
      sub: 'user-1',
      phone: '0812',
    } as never);
    expect(svc.open).toHaveBeenCalledWith(
      { depotId: DEPOT, openingFloat: 100 },
      { id: 'user-1', name: '0812' },
    );
    await c.open({ depotId: DEPOT, openingFloat: 100 } as never, {
      sub: 'user-1',
      phone: null,
    } as never);
    expect(svc.open).toHaveBeenLastCalledWith(expect.anything(), { id: 'user-1', name: 'user-1' });
  });

  it('asks for the caller own shift, never the depot at large', async () => {
    await c.current({ depotId: DEPOT } as never, { sub: 'user-1' } as never);
    expect(svc.current).toHaveBeenCalledWith(DEPOT, 'user-1');
  });

  it('lists the depot shifts', async () => {
    await c.list({ depotId: DEPOT } as never);
    expect(svc.list).toHaveBeenCalledWith(DEPOT);
  });

  // A cashier closes their own drawer. Closing somebody else's is a finance act, and
  // KEPALA_DEPOT deliberately does NOT get it: they stand at the same till, so letting
  // them settle a colleague's drawer would put the count and the cash in one pair of hands.
  it('grants close-anyone only to depot finance roles', async () => {
    await c.close(ID, { countedCash: 1 } as never, { sub: 'u1', role: 'MANAGER' } as never);
    expect(svc.close).toHaveBeenLastCalledWith(ID, { countedCash: 1 }, {
      id: 'u1',
      canCloseAnyShift: true,
    });
    await c.close(ID, { countedCash: 1 } as never, { sub: 'u2', role: 'KEPALA_DEPOT' } as never);
    expect(svc.close).toHaveBeenLastCalledWith(ID, { countedCash: 1 }, {
      id: 'u2',
      canCloseAnyShift: false,
    });
  });
});

describe('CashbookController', () => {
  const svc = { list: jest.fn(), record: jest.fn() };
  const c = new CashbookController(svc as never);
  beforeEach(() => jest.clearAllMocks());

  it('lists with and without a date window', async () => {
    await c.list({ depotId: DEPOT } as never);
    expect(svc.list).toHaveBeenCalledWith(DEPOT, { from: undefined, to: undefined });
    await c.list({ depotId: DEPOT, from: ISO, to: ISO } as never);
    expect(svc.list).toHaveBeenLastCalledWith(DEPOT, { from: new Date(ISO), to: new Date(ISO) });
  });

  it('records with and without occurredAt', async () => {
    await c.record(
      { depotId: DEPOT, direction: 'IN', category: 'C', label: 'l', amountIdr: 1 } as never,
      user,
    );
    expect(svc.record).toHaveBeenCalledWith(
      expect.objectContaining({ occurredAt: undefined }),
      'user-1',
    );
    await c.record(
      {
        depotId: DEPOT,
        direction: 'IN',
        category: 'C',
        label: 'l',
        amountIdr: 1,
        occurredAt: ISO,
      } as never,
      user,
    );
    expect(svc.record).toHaveBeenLastCalledWith(
      expect.objectContaining({ occurredAt: new Date(ISO) }),
      'user-1',
    );
  });
});

describe('DisputeController', () => {
  const svc = { raise: jest.fn(), list: jest.fn(), get: jest.fn(), resolve: jest.fn() };
  const c = new DisputeController(svc as never);
  beforeEach(() => {
    jest.clearAllMocks();
    svc.get.mockResolvedValue({ depotId: DEPOT });
  });

  it('raises with and without courierName, lists and resolves', async () => {
    await c.raise(
      {
        depotId: DEPOT,
        orderRef: 'o',
        customerName: 'c',
        category: 'x',
        description: 'd',
        amountIdr: 1,
      } as never,
      user,
    );
    expect(svc.raise).toHaveBeenCalledWith(
      expect.objectContaining({ courierName: null }),
      'user-1',
    );
    await c.raise(
      {
        depotId: DEPOT,
        orderRef: 'o',
        customerName: 'c',
        category: 'x',
        description: 'd',
        amountIdr: 1,
        courierName: 'k',
      } as never,
      user,
    );
    expect(svc.raise).toHaveBeenLastCalledWith(
      expect.objectContaining({ courierName: 'k' }),
      'user-1',
    );
    await c.list({ depotId: DEPOT, status: 'OPEN' } as never);
    expect(svc.list).toHaveBeenCalledWith(DEPOT, 'OPEN');
    await c.resolve(ID, { resolution: 'REFUND' } as never, user);
    expect(svc.resolve).toHaveBeenLastCalledWith(ID, 'REFUND', null, 'user-1');
    await c.resolve(ID, { resolution: 'REFUND', resolutionNote: 'n' } as never, user);
    expect(svc.resolve).toHaveBeenLastCalledWith(ID, 'REFUND', 'n', 'user-1');
  });
});

describe('DriverGallonReturnController', () => {
  const svc = { recordFromCourier: jest.fn() };
  const c = new DriverGallonReturnController(svc as never);
  beforeEach(() => jest.clearAllMocks());

  it('records with and without optional customerId/note', async () => {
    await c.record({ depotId: DEPOT, orderId: 'o', quantity: 2, condition: 'GOOD' } as never, user);
    expect(svc.recordFromCourier).toHaveBeenCalledWith(
      DEPOT,
      expect.objectContaining({ customerId: null, note: null }),
      'user-1',
    );
    await c.record(
      {
        depotId: DEPOT,
        orderId: 'o',
        customerId: 'cu',
        quantity: 2,
        condition: 'GOOD',
        note: 'n',
      } as never,
      user,
    );
    expect(svc.recordFromCourier).toHaveBeenLastCalledWith(
      DEPOT,
      expect.objectContaining({ customerId: 'cu', note: 'n' }),
      'user-1',
    );
  });
});

describe('FranchiseApplicationController', () => {
  const svc = {
    list: jest.fn(),
    get: jest.fn(),
    patch: jest.fn(),
    approve: jest.fn(),
    reject: jest.fn(),
    create: jest.fn(),
  };
  const c = new FranchiseApplicationController(svc as never);
  beforeEach(() => jest.clearAllMocks());

  const submission = {
    applicantName: 'Budi Santoso',
    applicantPhone: '+628123456789',
    proposedCode: ' bdg-02 ',
    proposedName: 'Depot Buah Batu',
    city: 'Bandung',
    province: 'Jawa Barat',
    lat: -6.9421,
    lng: 107.6386,
    investmentAmount: 150_000_000,
    projectedMonthlyRevenue: 45_000_000,
  };

  // UAT-M14-06: a prospective partner had no way to apply — the queue was HQ-only.
  it('accepts a public submission, normalising the proposed code', async () => {
    svc.create.mockResolvedValue({
      id: ID,
      proposedCode: 'BDG-02',
      proposedName: 'Depot Buah Batu',
      submittedAt: new Date('2026-07-27T00:00:00Z'),
      stage: 'PENDING',
      checklist: {},
    });
    await c.submit(submission as never);
    expect(svc.create).toHaveBeenCalledWith(
      expect.objectContaining({ proposedCode: 'BDG-02', stage: 'PENDING' }),
    );
  });

  // Nobody submits themselves pre-verified, and nobody reads the pipeline anonymously.
  it('forces a fresh PENDING checklist and returns a receipt, not the record', async () => {
    svc.create.mockResolvedValue({
      id: ID,
      proposedCode: 'BDG-02',
      proposedName: 'Depot Buah Batu',
      submittedAt: new Date('2026-07-27T00:00:00Z'),
      stage: 'PENDING',
      checklist: { ktpNpwp: 'VERIFIED' },
    });
    const out = await c.submit({
      ...submission,
      stage: 'APPROVED',
      checklist: { ktpNpwp: 'VERIFIED' },
    } as never);
    const sent = svc.create.mock.calls[0][0];
    expect(sent.stage).toBe('PENDING');
    expect(Object.values(sent.checklist)).toEqual(['PENDING', 'PENDING', 'PENDING', 'PENDING']);
    expect(Object.keys(out).sort()).toEqual(['id', 'proposedCode', 'proposedName', 'submittedAt']);
  });

  it('lists with defaults and explicit paging', async () => {
    await c.list({} as never);
    expect(svc.list).toHaveBeenCalledWith({ page: 1, limit: 20, stage: undefined });
    await c.list({ page: 3, limit: 5, stage: 'DOCS' } as never);
    expect(svc.list).toHaveBeenLastCalledWith({ page: 3, limit: 5, stage: 'DOCS' });
  });

  it('gets, patches, approves and rejects', async () => {
    await c.get(ID);
    expect(svc.get).toHaveBeenCalledWith(ID);
    await c.patch(ID, { stage: 'DOCS', checklist: {} } as never);
    expect(svc.patch).toHaveBeenCalledWith(ID, { stage: 'DOCS', checklist: {} });
    await c.approve(ID);
    expect(svc.approve).toHaveBeenCalledWith(ID);
    await c.reject(ID);
    expect(svc.reject).toHaveBeenCalledWith(ID);
  });
});

describe('GallonIssueController', () => {
  const issues = { record: jest.fn(), summary: jest.fn(), list: jest.fn() };
  const depots = { get: jest.fn() };
  const c = new GallonIssueController(issues as never, depots as never);
  beforeEach(() => {
    jest.clearAllMocks();
    depots.get.mockResolvedValue({ ownerId: null });
  });

  it('records with and without optional fields', async () => {
    await c.record(DEPOT, { quantity: 2, depositHeld: 1 } as never, user);
    expect(issues.record).toHaveBeenCalledWith(
      DEPOT,
      expect.objectContaining({ customerId: null, note: null }),
      'user-1',
    );
    await c.record(
      DEPOT,
      { customerId: 'cu', quantity: 2, depositHeld: 1, note: 'n' } as never,
      user,
    );
    expect(issues.record).toHaveBeenLastCalledWith(
      DEPOT,
      expect.objectContaining({ customerId: 'cu', note: 'n' }),
      'user-1',
    );
  });

  it('summarizes and lists with default and explicit paging', async () => {
    await c.summary(DEPOT, user);
    expect(issues.summary).toHaveBeenCalledWith(DEPOT);
    await c.list(DEPOT, {} as never, user);
    expect(issues.list).toHaveBeenCalledWith(DEPOT, 1, 20);
    await c.list(DEPOT, { page: 2, limit: 5 } as never, user);
    expect(issues.list).toHaveBeenLastCalledWith(DEPOT, 2, 5);
  });
});

describe('GallonNetworkController', () => {
  const gallon = { outstanding: jest.fn(), perCustomer: jest.fn(), customerLedger: jest.fn() };
  const depots = { listMine: jest.fn() };
  const c = new GallonNetworkController(gallon as never, depots as never);
  const CUSTOMER = '22222222-2222-4222-8222-222222222222';
  beforeEach(() => {
    jest.clearAllMocks();
    gallon.outstanding.mockResolvedValue([{ depotId: DEPOT }, { depotId: 'other' }]);
    gallon.perCustomer.mockResolvedValue([]);
    gallon.customerLedger.mockResolvedValue([]);
  });

  it('passes both ids straight through to the customer ledger', async () => {
    await expect(c.customerLedger(DEPOT, CUSTOMER)).resolves.toEqual([]);
    expect(gallon.customerLedger).toHaveBeenCalledWith(DEPOT, CUSTOMER);
  });

  // J-2: the per-customer read customer-service calls over the internal key. No depot
  // filtering here — the caller names one depot and the guard is the key itself.
  it('passes the depot straight through to the per-customer ledger', async () => {
    await expect(c.perCustomer(DEPOT)).resolves.toEqual([]);
    expect(gallon.perCustomer).toHaveBeenCalledWith(DEPOT);
  });

  it('returns the full network rollup for HQ roles', async () => {
    const rows = await c.outstanding(user);
    expect(rows).toHaveLength(2);
    expect(depots.listMine).not.toHaveBeenCalled();
  });

  it('filters to owned depots for a franchise owner', async () => {
    depots.listMine.mockResolvedValue([{ id: DEPOT }]);
    const owner = { sub: 'o1', role: Role.FRANCHISE_OWNER } as AuthenticatedUser;
    const rows = await c.outstanding(owner);
    expect(rows).toEqual([{ depotId: DEPOT }]);
  });
});

describe('GallonReturnController', () => {
  const returns = { record: jest.fn(), summary: jest.fn(), list: jest.fn() };
  const depots = { get: jest.fn() };
  const c = new GallonReturnController(returns as never, depots as never);
  beforeEach(() => {
    jest.clearAllMocks();
    depots.get.mockResolvedValue({ ownerId: null });
  });

  it('records with and without optional fields', async () => {
    await c.record(DEPOT, { quantity: 2, condition: 'GOOD', depositRefunded: 1 } as never, user);
    expect(returns.record).toHaveBeenCalledWith(
      DEPOT,
      expect.objectContaining({ customerId: null, note: null }),
      'user-1',
    );
    await c.record(
      DEPOT,
      { customerId: 'cu', quantity: 2, condition: 'GOOD', depositRefunded: 1, note: 'n' } as never,
      user,
    );
    expect(returns.record).toHaveBeenLastCalledWith(
      DEPOT,
      expect.objectContaining({ customerId: 'cu', note: 'n' }),
      'user-1',
    );
  });

  it('summarizes and lists with default and explicit paging', async () => {
    await c.summary(DEPOT, user);
    expect(returns.summary).toHaveBeenCalledWith(DEPOT);
    await c.list(DEPOT, {} as never, user);
    expect(returns.list).toHaveBeenCalledWith(DEPOT, 1, 20);
    await c.list(DEPOT, { page: 2, limit: 5 } as never, user);
    expect(returns.list).toHaveBeenLastCalledWith(DEPOT, 2, 5);
  });
});

describe('HandoverController', () => {
  const svc = { record: jest.fn(), list: jest.fn(), get: jest.fn(), sign: jest.fn() };
  const c = new HandoverController(svc as never);
  beforeEach(() => {
    jest.clearAllMocks();
    svc.get.mockResolvedValue({ depotId: DEPOT });
  });

  it('records with and without note, lists and signs', async () => {
    await c.record(
      {
        depotId: DEPOT,
        fromShift: 'A',
        toShift: 'B',
        fromStaff: 'x',
        toStaff: 'y',
        items: [],
      } as never,
      user,
    );
    expect(svc.record).toHaveBeenCalledWith(expect.objectContaining({ note: null }), 'user-1');
    await c.record(
      {
        depotId: DEPOT,
        fromShift: 'A',
        toShift: 'B',
        fromStaff: 'x',
        toStaff: 'y',
        items: [],
        note: 'n',
      } as never,
      user,
    );
    expect(svc.record).toHaveBeenLastCalledWith(expect.objectContaining({ note: 'n' }), 'user-1');
    await c.list({ depotId: DEPOT } as never);
    expect(svc.list).toHaveBeenCalledWith(DEPOT);
    await c.sign(ID, user);
    expect(svc.sign).toHaveBeenCalledWith(ID);
  });
});

describe('HuddleController', () => {
  const svc = { getForWeek: jest.fn(), list: jest.fn(), record: jest.fn() };
  const c = new HuddleController(svc as never);
  beforeEach(() => jest.clearAllMocks());

  it('lists by week or all, and upserts with/without attendance', async () => {
    await c.list({ depotId: DEPOT, weekStart: '2026-07-14' } as never);
    expect(svc.getForWeek).toHaveBeenCalledWith(DEPOT, '2026-07-14');
    await c.list({ depotId: DEPOT } as never);
    expect(svc.list).toHaveBeenCalledWith(DEPOT);
    await c.upsert(
      { depotId: DEPOT, weekStart: '2026-07-14', agenda: 'a', actionItems: [] } as never,
      user,
    );
    expect(svc.record).toHaveBeenCalledWith(
      expect.objectContaining({ attendance: null }),
      'user-1',
    );
    await c.upsert(
      {
        depotId: DEPOT,
        weekStart: '2026-07-14',
        attendance: 5,
        agenda: 'a',
        actionItems: [],
      } as never,
      user,
    );
    expect(svc.record).toHaveBeenLastCalledWith(
      expect.objectContaining({ attendance: 5 }),
      'user-1',
    );
  });
});

describe('IncidentController', () => {
  const svc = { record: jest.fn(), list: jest.fn(), get: jest.fn(), resolve: jest.fn() };
  const c = new IncidentController(svc as never);
  beforeEach(() => {
    jest.clearAllMocks();
    svc.get.mockResolvedValue({ depotId: DEPOT });
  });

  it('records with and without optionals, lists, gets and resolves', async () => {
    await c.record({ depotId: DEPOT, type: 'T', severity: 'LOW', title: 't' } as never, user);
    expect(svc.record).toHaveBeenCalledWith(
      expect.objectContaining({ description: null, courierName: null, orderRef: null }),
      'user-1',
    );
    await c.record(
      {
        depotId: DEPOT,
        type: 'T',
        severity: 'LOW',
        title: 't',
        description: 'd',
        courierName: 'k',
        orderRef: 'o',
      } as never,
      user,
    );
    expect(svc.record).toHaveBeenLastCalledWith(
      expect.objectContaining({ description: 'd', courierName: 'k', orderRef: 'o' }),
      'user-1',
    );
    await c.list({ depotId: DEPOT, status: 'OPEN' } as never);
    expect(svc.list).toHaveBeenCalledWith(DEPOT, { status: 'OPEN' });
    await c.get(ID, user);
    expect(svc.get).toHaveBeenCalledWith(ID);
    await c.resolve(ID, { note: 'done' } as never, user);
    expect(svc.resolve).toHaveBeenCalledWith(ID, 'done', 'user-1');
  });
});

describe('MaintenanceController', () => {
  const svc = { create: jest.fn(), list: jest.fn(), get: jest.fn(), markServiced: jest.fn() };
  const c = new MaintenanceController(svc as never);
  beforeEach(() => {
    jest.clearAllMocks();
    svc.get.mockResolvedValue({ depotId: DEPOT });
  });

  it('creates with and without lastServicedAt/note', async () => {
    await c.create({
      depotId: DEPOT,
      name: 'n',
      category: 'c',
      intervalDays: 30,
      nextDueAt: ISO,
    } as never);
    expect(svc.create).toHaveBeenCalledWith(
      expect.objectContaining({ lastServicedAt: null, note: null }),
    );
    await c.create({
      depotId: DEPOT,
      name: 'n',
      category: 'c',
      intervalDays: 30,
      nextDueAt: ISO,
      lastServicedAt: ISO,
      note: 'x',
    } as never);
    expect(svc.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ lastServicedAt: new Date(ISO), note: 'x' }),
    );
  });

  it('lists and marks serviced', async () => {
    await c.list({ depotId: DEPOT } as never);
    expect(svc.list).toHaveBeenCalledWith(DEPOT);
    await c.markServiced(ID, user);
    expect(svc.markServiced).toHaveBeenCalledWith(ID);
  });
});

describe('Price override controllers', () => {
  const svc = {
    propose: jest.fn(),
    list: jest.fn(),
    countByProduct: jest.fn(),
    get: jest.fn(),
    approve: jest.fn(),
    reject: jest.fn(),
  };
  const depotC = new DepotPriceOverrideController(svc as never);
  const hqC = new PriceOverrideController(svc as never);
  beforeEach(() => {
    jest.clearAllMocks();
    svc.get.mockResolvedValue({ depotId: DEPOT });
  });

  it('proposes with and without note', async () => {
    await depotC.propose(user, DEPOT, {
      productId: 'p',
      productName: 'n',
      currentPrice: 1,
      adjustType: 'ABS',
      value: 2,
    } as never);
    expect(svc.propose).toHaveBeenCalledWith(
      DEPOT,
      'user-1',
      expect.objectContaining({ note: null }),
    );
    await depotC.propose(user, DEPOT, {
      productId: 'p',
      productName: 'n',
      currentPrice: 1,
      adjustType: 'ABS',
      value: 2,
      note: 'x',
    } as never);
    expect(svc.propose).toHaveBeenLastCalledWith(
      DEPOT,
      'user-1',
      expect.objectContaining({ note: 'x' }),
    );
  });

  it('lists with defaults and explicit values, counts, approves and rejects', async () => {
    await hqC.list({} as never);
    expect(svc.list).toHaveBeenCalledWith({ page: 1, limit: 20, status: 'PENDING' });
    await hqC.list({ page: 2, limit: 5, status: 'APPROVED' } as never);
    expect(svc.list).toHaveBeenLastCalledWith({ page: 2, limit: 5, status: 'APPROVED' });
    await hqC.countByProduct();
    expect(svc.countByProduct).toHaveBeenCalled();
    await hqC.approve(user, ID);
    expect(svc.approve).toHaveBeenCalledWith(ID, 'user-1');
    await hqC.reject(user, ID);
    expect(svc.reject).toHaveBeenCalledWith(ID, 'user-1');
  });
});

describe('PricingController', () => {
  const svc = {
    create: jest.fn(),
    list: jest.fn(),
    get: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  };
  const c = new PricingController(svc as never);
  beforeEach(() => {
    jest.clearAllMocks();
    svc.get.mockResolvedValue({ depotId: DEPOT });
  });

  it('creates with defaults and with all optional fields', async () => {
    await c.create(DEPOT, { adjustType: 'ABS', value: 1 } as never);
    expect(svc.create).toHaveBeenCalledWith(
      DEPOT,
      expect.objectContaining({
        productId: null,
        daysOfWeek: [],
        startMinute: null,
        endMinute: null,
        validFrom: null,
        validUntil: null,
        priority: 0,
        active: true,
      }),
    );
    await c.create(DEPOT, {
      productId: 'p',
      adjustType: 'ABS',
      value: 1,
      daysOfWeek: [1],
      startMinute: 60,
      endMinute: 120,
      validFrom: ISO,
      validUntil: ISO,
      priority: 5,
      active: false,
    } as never);
    expect(svc.create).toHaveBeenLastCalledWith(
      DEPOT,
      expect.objectContaining({
        productId: 'p',
        validFrom: new Date(ISO),
        validUntil: new Date(ISO),
        priority: 5,
        active: false,
      }),
    );
  });

  it('lists, removes and updates with an empty and a full patch', async () => {
    await c.list(DEPOT);
    expect(svc.list).toHaveBeenCalledWith(DEPOT);
    await c.update(ID, {} as never, user);
    expect(svc.update).toHaveBeenCalledWith(ID, {});
    await c.update(
      ID,
      {
        productId: 'p',
        adjustType: 'ABS',
        value: 1,
        daysOfWeek: [1],
        startMinute: 1,
        endMinute: 2,
        validFrom: ISO,
        validUntil: ISO,
        priority: 3,
        active: true,
      } as never,
      user,
    );
    expect(svc.update).toHaveBeenLastCalledWith(
      ID,
      expect.objectContaining({ productId: 'p', validFrom: new Date(ISO), active: true }),
    );
    // productId explicitly null exercises the `?? null` inside the defined branch;
    // validFrom set to null exercises toDate(undefined) → null
    await c.update(ID, { productId: null, validFrom: null } as never, user);
    expect(svc.update).toHaveBeenLastCalledWith(ID, { productId: null, validFrom: null });
    await c.remove(ID, user);
    expect(svc.remove).toHaveBeenCalledWith(ID);
  });
});

describe('DepotController', () => {
  const svc = {
    browse: jest.fn(),
    findNearby: jest.fn(),
    listMine: jest.fn(),
    get: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    deactivate: jest.fn(),
  };
  const storage = { put: jest.fn() };
  const c = new DepotController(svc as never, storage as never);
  beforeEach(() => {
    jest.clearAllMocks();
    storage.put.mockResolvedValue({ url: 'https://cdn.example/qris/abc.png', key: 'qris/abc.png' });
    svc.listMine.mockResolvedValue([{ id: DEPOT }]);
    // browse/get now map through PublicDepotView, so the stubs have to return real rows.
    svc.browse.mockResolvedValue({
      items: [{ id: DEPOT, name: 'D' }],
      total: 1,
      page: 1,
      limit: 20,
    });
    svc.get.mockResolvedValue({ id: DEPOT, name: 'D', paymentBankAccountNumber: '123' });
    // nearby maps through NearbyDepotView for the same reason browse/get do.
    svc.findNearby.mockResolvedValue([
      { id: DEPOT, name: 'D', paymentBankAccountNumber: '123', distanceKm: 1.2, withinService: true },
    ]);
  });

  // UAT-M11-09: the public routes used to serve the whole DepotRecord, publishing every
  // depot's bank account to anonymous callers.
  it('keeps bank details and ownership out of the public browse/detail/nearby payloads', async () => {
    const leaks = [
      'paymentBankName',
      'paymentBankAccountNumber',
      'paymentBankAccountHolder',
      'paymentQrisImageUrl',
      'ownerId',
      'ownershipType',
    ];
    const page = await c.browse({ page: 1 } as never);
    const one = await c.get(DEPOT);
    // `nearby` is anonymous too and was still returning the whole DepotRecord — the same
    // leak this test was written to close, one route over.
    const near = await c.nearby({ lat: 1, lng: 2 } as never);
    for (const key of leaks) {
      expect(page.items[0]).not.toHaveProperty(key);
      expect(one).not.toHaveProperty(key);
      expect(near[0]).not.toHaveProperty(key);
    }
    expect(one).toHaveProperty('name');
    // …while still carrying what the "buka/tutup" badge and the distance chip need.
    expect(near[0]).toMatchObject({ name: 'D', distanceKm: 1.2, withinService: true });
    expect(near[0]).toHaveProperty('operatingHours');
    expect(near[0]).toHaveProperty('holidays');
  });

  it('serves the payment destination only on the dedicated authenticated route', async () => {
    await expect(c.paymentInfo(DEPOT)).resolves.toMatchObject({
      name: 'D',
      paymentBankAccountNumber: '123',
    });
  });

  // Depot SOP §3: order-service's cron reads the depot phone numbers here rather than off
  // the public projection, so they are not scrapeable by an anonymous caller.
  it('serves depot phone numbers only on the internal-key route', async () => {
    svc.browse.mockResolvedValueOnce({
      items: [
        { id: DEPOT, name: 'D', contactPhone: '0811', paymentBankAccountNumber: '123' },
        { id: 'd2', name: 'E', contactPhone: null },
      ],
      total: 2,
      page: 1,
      limit: 1000,
    });
    const out = await c.internalContacts();
    expect(out).toEqual({
      depots: [
        { id: DEPOT, name: 'D', contactPhone: '0811' },
        { id: 'd2', name: 'E', contactPhone: null },
      ],
    });
    // Active depots only — a deactivated depot has nobody to send a sales report to.
    expect(svc.browse).toHaveBeenCalledWith({ page: 1, limit: 1000 }, true);
    // …and the public browse next to it still carries no phone number at all.
    const page = await c.browse({ page: 1 } as never);
    expect(page.items[0]).not.toHaveProperty('contactPhone');
  });

  it('browses, finds nearby (default+explicit), manages, mine, get and remove', async () => {
    await c.browse({ page: 1 } as never);
    expect(svc.browse).toHaveBeenCalledWith({ page: 1 }, true);
    await c.nearby({ lat: 1, lng: 2 } as never);
    expect(svc.findNearby).toHaveBeenCalledWith(1, 2, 10);
    await c.nearby({ lat: 1, lng: 2, limit: 3 } as never);
    expect(svc.findNearby).toHaveBeenLastCalledWith(1, 2, 3);
    const owned = await c.internalOwned('owner-1');
    expect(owned).toEqual({ depotIds: [DEPOT] });
    // Owner lookup for the franchise revenue push: both an owned and an ownerless depot.
    svc.get.mockResolvedValueOnce({ ownerId: 'owner-1', ownershipType: 'WARALABA' });
    expect(await c.internalOwner(DEPOT)).toEqual({
      ownerId: 'owner-1',
      ownershipType: 'WARALABA',
    });
    svc.get.mockResolvedValueOnce({ ownerId: null, ownershipType: 'HKP' });
    expect(await c.internalOwner(DEPOT)).toEqual({ ownerId: null, ownershipType: 'HKP' });
    await c.manage({} as never);
    expect(svc.browse).toHaveBeenLastCalledWith({}, false);
    await c.mine(user);
    expect(svc.listMine).toHaveBeenCalledWith('user-1');
    await c.get(ID);
    expect(svc.get).toHaveBeenCalledWith(ID, true);
    await c.remove(ID);
    expect(svc.deactivate).toHaveBeenCalledWith(ID);
  });

  it('creates with defaults and with all optional fields', async () => {
    const base = {
      code: 'C',
      name: 'N',
      ownershipType: 'CORPORATE',
      address: 'a',
      city: 'c',
      province: 'p',
      lat: 1,
      lng: 2,
      deliveryFee: 5000,
    };
    await c.create(base as never);
    expect(svc.create).toHaveBeenCalledWith(
      expect.objectContaining({
        serviceRadiusKm: 5,
        minOrderAmount: null,
        ownerId: null,
        operatingHours: {},
        holidays: [],
      }),
    );
    await c.create({
      ...base,
      serviceRadiusKm: 7,
      minOrderAmount: 1,
      ownerId: 'o',
      paymentBankName: 'b',
      paymentBankAccountNumber: '1',
      paymentBankAccountHolder: 'h',
      paymentQrisImageUrl: 'u',
      operatingHours: { mon: {} },
      holidays: [{ date: 'd' }],
    } as never);
    expect(svc.create).toHaveBeenLastCalledWith(
      expect.objectContaining({
        serviceRadiusKm: 7,
        minOrderAmount: 1,
        ownerId: 'o',
        paymentBankName: 'b',
      }),
    );
  });

  it('updates a depot', async () => {
    await c.update(ID, { active: false } as never);
    expect(svc.update).toHaveBeenCalledWith(ID, { active: false });
  });

  // The full record carries bank details and ownership: a franchise owner may open their own
  // depot's row and nobody else's.
  it('lets a franchise owner manage only their own depot', async () => {
    const owner = {
      sub: 'owner-1',
      role: Role.FRANCHISE_OWNER,
      depotId: null,
    } as AuthenticatedUser;
    svc.get.mockResolvedValue({ id: DEPOT, ownerId: 'owner-2' });
    await expect(c.manageOne(owner, DEPOT)).rejects.toBeInstanceOf(ForbiddenException);
    svc.get.mockResolvedValue({ id: DEPOT, ownerId: 'owner-1' });
    await expect(c.manageOne(owner, DEPOT)).resolves.toMatchObject({ id: DEPOT });
    // A head-office role is not owner-scoped at all.
    await expect(c.manageOne(user, DEPOT)).resolves.toMatchObject({ id: DEPOT });
  });

  describe('uploadQris', () => {
    // H-20: the upload path reads magic bytes, so a fake file needs real ones.
    const PNG_BYTES = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(8),
    ]);
    const file = (over: Partial<{ mimetype: string; size: number; buffer: Buffer }> = {}) => ({
      buffer: PNG_BYTES,
      mimetype: 'image/png',
      size: 10,
      originalname: 'q.png',
      ...over,
    });

    it('rejects a missing file', async () => {
      await expect(c.uploadQris(ID, undefined)).rejects.toBeInstanceOf(BadRequestException);
    });
    it('rejects an unsupported file, however it was labelled', async () => {
      await expect(
        c.uploadQris(ID, file({ buffer: Buffer.from('%PDF-1.7 not an image') }) as never),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        c.uploadQris(ID, file({ buffer: Buffer.from('<script>alert(1)</script>  ') }) as never),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
    it('rejects a file over the size limit', async () => {
      await expect(
        c.uploadQris(ID, file({ size: 6 * 1024 * 1024 }) as never),
      ).rejects.toBeInstanceOf(PayloadTooLargeException);
    });
    it('stores the file and persists the ABSOLUTE url the storage returns', async () => {
      await c.uploadQris(ID, file() as never);
      expect(storage.put).toHaveBeenCalledWith({
        body: PNG_BYTES,
        contentType: 'image/png',
        ext: 'png',
      });
      expect(svc.update).toHaveBeenCalledWith(ID, {
        paymentQrisImageUrl: 'https://cdn.example/qris/abc.png',
      });
    });

    // Unreachable object storage is infrastructure, not a bad request — and the depot must
    // NOT be left pointing at an image that was never written.
    it('answers 503 and writes nothing when storage is down', async () => {
      storage.put.mockRejectedValueOnce(new Error('endpoint unreachable'));
      await expect(c.uploadQris(ID, file() as never)).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      expect(svc.update).not.toHaveBeenCalled();
    });
  });
});

describe('HierarchyController', () => {
  const svc = { scopedDepotIds: jest.fn().mockResolvedValue([DEPOT]) };
  const c = new HierarchyController(svc as never);

  it('treats a missing role query as an empty role', async () => {
    expect(await c.internalScope(ID, undefined as never)).toEqual({ depotIds: [DEPOT] });
    expect(svc.scopedDepotIds).toHaveBeenCalledWith(ID, '');
  });
});

describe('DepotTargetController', () => {
  const svc = { get: jest.fn(), set: jest.fn() };
  const c = new DepotTargetController(svc as never);
  beforeEach(() => jest.clearAllMocks());

  it('gets and sets a monthly target', async () => {
    await c.get({ depotId: DEPOT, month: '2026-07' } as never);
    expect(svc.get).toHaveBeenCalledWith(DEPOT, '2026-07');
    await c.set(
      {
        depotId: DEPOT,
        month: '2026-07',
        revenueTargetIdr: 1,
        ordersTarget: 2,
        slaTargetPct: 3,
        newCustomersTarget: 4,
      } as never,
      user,
    );
    expect(svc.set).toHaveBeenCalledWith(
      expect.objectContaining({ depotId: DEPOT, month: '2026-07' }),
      'user-1',
    );
  });
});

describe('RosterController', () => {
  const svc = { week: jest.fn(), setCell: jest.fn(), bulkSet: jest.fn() };
  const c = new RosterController(svc as never);
  beforeEach(() => jest.clearAllMocks());

  // B1: every route hands the CALLER to the service — that is where the depot check is.
  const kd = { sub: 'kd-1', role: 'KEPALA_DEPOT', phone: '0811', depotId: DEPOT } as never;

  it('reads a week, sets one cell and bulk-sets, always passing the caller', async () => {
    await c.week({ depotId: DEPOT, weekStart: '2026-07-14' } as never, kd);
    expect(svc.week).toHaveBeenCalledWith(kd, DEPOT, '2026-07-14');
    await c.setCell(
      {
        depotId: DEPOT,
        weekStart: '2026-07-14',
        staffId: 's',
        staffName: 'n',
        day: 0,
        shift: 'MORNING',
      } as never,
      kd,
    );
    expect(svc.setCell).toHaveBeenCalledWith(kd, DEPOT, '2026-07-14', 's', 'n', 0, 'MORNING');
    await c.bulk({ depotId: DEPOT, weekStart: '2026-07-14', cells: [] } as never, kd);
    expect(svc.bulkSet).toHaveBeenCalledWith(kd, DEPOT, '2026-07-14', []);
  });
});

describe('SubscriptionController', () => {
  const svc = {
    list: jest.fn(),
    create: jest.fn(),
    get: jest.fn(),
    pause: jest.fn(),
    resume: jest.fn(),
  };
  const c = new SubscriptionController(svc as never);
  beforeEach(() => {
    jest.clearAllMocks();
    svc.get.mockResolvedValue({ depotId: DEPOT });
  });

  it('lists, creates with defaults/optionals, pauses and resumes', async () => {
    await c.list({ depotId: DEPOT, status: 'ACTIVE' } as never);
    expect(svc.list).toHaveBeenCalledWith(DEPOT, { status: 'ACTIVE' });
    await c.create({
      depotId: DEPOT,
      customerName: 'c',
      productLabel: 'p',
      quantity: 1,
      cadence: 'WEEKLY',
    } as never);
    expect(svc.create).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: null, nextRunAt: null, note: null }),
    );
    await c.create({
      depotId: DEPOT,
      customerId: 'cu',
      customerName: 'c',
      productLabel: 'p',
      quantity: 1,
      cadence: 'WEEKLY',
      nextRunAt: ISO,
      note: 'n',
    } as never);
    expect(svc.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ customerId: 'cu', nextRunAt: new Date(ISO), note: 'n' }),
    );
    await c.pause(ID, user);
    expect(svc.pause).toHaveBeenCalledWith(ID);
    await c.resume(ID, user);
    expect(svc.resume).toHaveBeenCalledWith(ID);
  });
});

describe('SupplierController', () => {
  const svc = { create: jest.fn(), list: jest.fn(), get: jest.fn() };
  const c = new SupplierController(svc as never);
  beforeEach(() => {
    jest.clearAllMocks();
    svc.get.mockResolvedValue({ depotId: DEPOT });
  });

  it('creates with defaults/optionals, lists and gets', async () => {
    await c.create({ depotId: DEPOT, name: 'n', code: 'c' } as never);
    expect(svc.create).toHaveBeenCalledWith(
      expect.objectContaining({ contactPhone: null, categories: [], onTimeRate: null }),
    );
    await c.create({
      depotId: DEPOT,
      name: 'n',
      code: 'c',
      contactPhone: '628',
      categories: ['x'],
      onTimeRate: 90,
    } as never);
    expect(svc.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ contactPhone: '628', categories: ['x'], onTimeRate: 90 }),
    );
    await c.list({ depotId: DEPOT } as never);
    expect(svc.list).toHaveBeenCalledWith(DEPOT);
    await c.get(ID, user);
    expect(svc.get).toHaveBeenCalledWith(ID);
  });
});

describe('WholesaleTierController', () => {
  const svc = {
    list: jest.fn(),
    create: jest.fn(),
    get: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  };
  const c = new WholesaleTierController(svc as never);
  beforeEach(() => {
    jest.clearAllMocks();
    svc.get.mockResolvedValue({ depotId: DEPOT });
  });

  it('lists, creates with defaults/optionals, updates and removes', async () => {
    await c.list({ depotId: DEPOT } as never);
    expect(svc.list).toHaveBeenCalledWith(DEPOT);
    await c.create({ depotId: DEPOT, label: 'l', minQty: 1, priceIdr: 100 } as never);
    expect(svc.create).toHaveBeenCalledWith(
      expect.objectContaining({ productId: null, maxQty: null }),
    );
    await c.create({
      depotId: DEPOT,
      productId: 'p',
      label: 'l',
      minQty: 1,
      maxQty: 10,
      priceIdr: 100,
    } as never);
    expect(svc.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ productId: 'p', maxQty: 10 }),
    );
    await c.update(ID, { priceIdr: 200 } as never, user);
    expect(svc.update).toHaveBeenCalledWith(ID, { priceIdr: 200 });
    const res = await c.remove(ID, user);
    expect(svc.remove).toHaveBeenCalledWith(ID);
    expect(res).toEqual({ deleted: true });
  });
});

describe('PurchaseOrderController', () => {
  const svc = {
    create: jest.fn(),
    list: jest.fn(),
    get: jest.fn(),
    send: jest.fn(),
    receive: jest.fn(),
  };
  const c = new PurchaseOrderController(svc as never);
  beforeEach(() => {
    jest.clearAllMocks();
    svc.get.mockResolvedValue({ depotId: DEPOT });
  });

  it('creates with and without expectedAt, lists, gets, sends and receives', async () => {
    await c.create({ depotId: DEPOT, supplierId: 's', lines: [], shippingIdr: 0 } as never);
    expect(svc.create).toHaveBeenCalledWith(expect.objectContaining({ expectedAt: null }));
    await c.create({
      depotId: DEPOT,
      supplierId: 's',
      lines: [],
      shippingIdr: 0,
      expectedAt: ISO,
    } as never);
    expect(svc.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ expectedAt: new Date(ISO) }),
    );
    await c.list({ depotId: DEPOT, status: 'DRAFT' } as never);
    expect(svc.list).toHaveBeenCalledWith(DEPOT, { status: 'DRAFT' });
    await c.get(ID, user);
    expect(svc.get).toHaveBeenCalledWith(ID);
    await c.send(ID, user);
    expect(svc.send).toHaveBeenCalledWith(ID);
    await c.receive(ID, user);
    expect(svc.receive).toHaveBeenCalledWith(ID, 'user-1');
  });
});

describe('Inventory controllers', () => {
  const inventory = {
    createLine: jest.fn(),
    listMovementsForDepot: jest.fn(),
    listForDepot: jest.fn(),
    consumeForOrder: jest.fn(),
    restockForOrder: jest.fn(),
    reserveForOrder: jest.fn(),
    releaseForOrder: jest.fn(),
    listLowStock: jest.fn(),
    wastageSummary: jest.fn(),
    get: jest.fn(),
    updateMeta: jest.fn(),
    adjust: jest.fn(),
    opname: jest.fn(),
    movements: jest.fn(),
  };
  const pricing = { resolvePrices: jest.fn() };
  const depotC = new DepotInventoryController(inventory as never, pricing as never);
  const itemC = new InventoryController(inventory as never);
  beforeEach(() => jest.clearAllMocks());

  it('creates a line with defaults and optionals', async () => {
    await depotC.create(DEPOT, { itemType: 'PRODUK', label: 'l', unit: 'pcs' } as never, user);
    expect(inventory.createLine).toHaveBeenCalledWith(
      DEPOT,
      expect.objectContaining({ productId: null, quantity: 0, minimumStock: 0, sellPrice: null }),
      'user-1',
    );
    await depotC.create(
      DEPOT,
      {
        itemType: 'PRODUK',
        productId: 'p',
        label: 'l',
        unit: 'pcs',
        quantity: 5,
        minimumStock: 2,
        sellPrice: 100,
      } as never,
      user,
    );
    expect(inventory.createLine).toHaveBeenLastCalledWith(
      DEPOT,
      expect.objectContaining({ productId: 'p', quantity: 5, sellPrice: 100 }),
      'user-1',
    );
  });

  it('resolves prices from a comma list and an empty query', async () => {
    await depotC.prices(DEPOT, 'a, b ,,c');
    expect(pricing.resolvePrices).toHaveBeenCalledWith(
      DEPOT,
      ['a', 'b', 'c'],
      expect.any(Date),
      [0],
    );
    await depotC.prices(DEPOT, undefined);
    expect(pricing.resolvePrices).toHaveBeenLastCalledWith(DEPOT, [], expect.any(Date), [0]);
  });

  it('parses wholesale quantities positionally and zeroes out junk', async () => {
    await depotC.prices(DEPOT, 'a,b,c', '10, 0 ,abc');
    expect(pricing.resolvePrices).toHaveBeenLastCalledWith(
      DEPOT,
      ['a', 'b', 'c'],
      expect.any(Date),
      [10, 0, 0],
    );
  });

  it('lists movements with defaults, explicit paging and rejects a reversed window', async () => {
    await depotC.movements(DEPOT, {} as never);
    expect(inventory.listMovementsForDepot).toHaveBeenCalledWith(
      DEPOT,
      expect.objectContaining({ from: undefined, to: undefined, page: 1, limit: 50 }),
    );
    await depotC.movements(DEPOT, {
      type: 'SALE',
      from: ISO,
      to: '2026-08-01T00:00:00.000Z',
      page: 2,
      limit: 5,
    } as never);
    expect(inventory.listMovementsForDepot).toHaveBeenLastCalledWith(
      DEPOT,
      expect.objectContaining({ page: 2, limit: 5 }),
    );
    expect(() =>
      depotC.movements(DEPOT, { from: '2026-08-01T00:00:00.000Z', to: ISO } as never),
    ).toThrow(BadRequestException);
  });

  it('lists lines and runs internal reserve/consume/release', async () => {
    await depotC.list(DEPOT, { itemType: 'PRODUK', lowStockOnly: true } as never);
    expect(inventory.listForDepot).toHaveBeenCalledWith(DEPOT, {
      itemType: 'PRODUK',
      lowStockOnly: true,
    });
    await depotC.consume(DEPOT, { orderId: 'o', items: [] } as never);
    expect(inventory.consumeForOrder).toHaveBeenCalledWith(DEPOT, 'o', [], 'order-service');
    await depotC.reserve(DEPOT, { orderId: 'o', items: [] } as never);
    expect(inventory.reserveForOrder).toHaveBeenCalledWith(DEPOT, 'o', [], 'order-service');
    await depotC.release(DEPOT, { orderId: 'o', items: [] } as never);
    expect(inventory.releaseForOrder).toHaveBeenCalledWith(DEPOT, 'o', []);
    await depotC.restock(DEPOT, { orderId: 'o', items: [] } as never);
    expect(inventory.restockForOrder).toHaveBeenCalledWith(DEPOT, 'o', [], 'order-service');
  });

  it('handles low-stock, wastage (with/without dates), get, update, adjust, opname and per-line movements', async () => {
    await itemC.lowStock(DEPOT);
    expect(inventory.listLowStock).toHaveBeenCalledWith(DEPOT);
    await itemC.wastage({ depotId: DEPOT } as never);
    expect(inventory.wastageSummary).toHaveBeenCalledWith(DEPOT, undefined, undefined);
    await itemC.wastage({ depotId: DEPOT, from: ISO, to: ISO } as never);
    expect(inventory.wastageSummary).toHaveBeenLastCalledWith(DEPOT, new Date(ISO), new Date(ISO));
    await itemC.get(ID);
    expect(inventory.get).toHaveBeenCalledWith(ID);
    await itemC.update(ID, { label: 'x' } as never);
    expect(inventory.updateMeta).toHaveBeenCalledWith(ID, { label: 'x' });
    await itemC.adjust(ID, { delta: 3 } as never, user, 'Bearer t');
    expect(inventory.adjust).toHaveBeenCalledWith(ID, 3, null, 'user-1', 'Bearer t');
    await itemC.adjust(ID, { delta: 3, reason: 'r' } as never, user, 'Bearer t');
    expect(inventory.adjust).toHaveBeenLastCalledWith(ID, 3, 'r', 'user-1', 'Bearer t');
    await itemC.opname(ID, { countedQuantity: 9 } as never, user, 'Bearer t');
    expect(inventory.opname).toHaveBeenCalledWith(ID, 9, null, 'user-1', 'Bearer t');
    await itemC.opname(ID, { countedQuantity: 9, reason: 'r' } as never, user, 'Bearer t');
    expect(inventory.opname).toHaveBeenLastCalledWith(ID, 9, 'r', 'user-1', 'Bearer t');
    await itemC.movements(ID);
    expect(inventory.movements).toHaveBeenCalledWith(ID);
  });
});
