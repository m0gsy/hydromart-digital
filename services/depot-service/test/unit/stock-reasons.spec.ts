import { ApprovalService } from '../../src/application/services/approval.service';
import { GallonIssueService } from '../../src/application/services/gallon-issue.service';
import { InventoryService } from '../../src/application/services/inventory.service';
import { DepotConfigService } from '../../src/config/depot-config.service';
import { ApprovalType } from '../../src/domain/approval';
import { InventoryItemType, OwnershipType } from '../../src/domain/inventory';
import { LENT_GALLON_REASON, OPNAME_REVERSAL_REASON } from '../../src/domain/stock-reasons';
import {
  FakeLowStockAlert,
  FakeProductCatalog,
  FakeUntrackedSaleAlert,
  InMemoryApprovalRepository,
  InMemoryDepotRepository,
  InMemoryGallonIssueRepository,
  InMemoryInventoryRepository,
} from '../support/fakes';

/*
 * HD-6 H4: the AI read API's wastage leaves out two kinds of negative adjustment by the START of
 * their reason (stock-reasons.ts). This drives the REAL writers and asserts the rows they write
 * start with that text, so rewording a writer breaks here instead of turning loans into "wastage".
 */
const DEPOT = {
  code: 'JKT-01',
  name: 'Depot Cikini',
  ownershipType: OwnershipType.HKP,
  address: 'a',
  city: 'Jakarta',
  province: 'DKI',
  lat: -6.19,
  lng: 106.84,
  serviceRadiusKm: 5,
  deliveryFee: 5000,
  minOrderAmount: null,
  ownerId: null,
  operatingHours: {},
  holidays: [],
};
const config = { gallonDepositIdr: () => 20000, approvalAutoPassIdr: () => 100 } as unknown as DepotConfigService;

describe('the reason texts the wastage reader keys on', () => {
  it('a gallon lent with a delivery is written with the lent-gallon prefix', async () => {
    const depots = new InMemoryDepotRepository();
    const invRepo = new InMemoryInventoryRepository();
    const approvals = new ApprovalService(new InMemoryApprovalRepository(), depots, config);
    const inventory = new InventoryService(invRepo, depots, new FakeLowStockAlert(), new FakeUntrackedSaleAlert(), new FakeProductCatalog(), approvals, config);
    const issues = new GallonIssueService(new InMemoryGallonIssueRepository(), depots, config, inventory, approvals);
    const depotId = (await depots.create(DEPOT)).id;
    await inventory.createLine(depotId, { itemType: InventoryItemType.GALON, label: 'Galon', unit: 'galon', quantity: 10, minimumStock: 0 } as never, 'staff-1');

    await issues.recordFromOrder(depotId, { orderId: 'o-1', quantity: 2 }, 'order-service');

    const lent = invRepo.moves.filter((m) => m.delta < 0);
    expect(lent).toHaveLength(1);
    expect(lent[0].reason?.startsWith(LENT_GALLON_REASON)).toBe(true);
  });

  it('the reversal of a rejected count is written with the reversal prefix', async () => {
    const depots = new InMemoryDepotRepository();
    const invRepo = new InMemoryInventoryRepository();
    const approvals = new ApprovalService(new InMemoryApprovalRepository(), depots, config);
    const inventory = new InventoryService(invRepo, depots, new FakeLowStockAlert(), new FakeUntrackedSaleAlert(), new FakeProductCatalog(), approvals, config);
    const depotId = (await depots.create(DEPOT)).id;
    const line = await inventory.createLine(depotId, { itemType: InventoryItemType.GALON, label: 'Galon', unit: 'galon', quantity: 10, minimumStock: 0 } as never, 'staff-1');
    const approval = await approvals.create(
      { depotId, type: ApprovalType.OPNAME_VARIANCE, title: 'Selisih opname', amountIdr: 500_000, payload: { itemId: line.id, variance: 3 } },
      'staff-1',
    );

    await approvals.decide(approval.id, 'REJECT', null, 'hq-1');

    const reversal = invRepo.moves.filter((m) => m.delta === -3);
    expect(reversal).toHaveLength(1);
    expect(reversal[0].reason?.startsWith(OPNAME_REVERSAL_REASON)).toBe(true);
  });
});
