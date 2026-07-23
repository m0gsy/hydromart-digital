import { randomUUID } from 'node:crypto';

import { OperationalReportRepository } from '../../src/application/ports/operational-report.repository';
import { OperationalReportService } from '../../src/application/services/operational-report.service';
import { DepotNotFoundError } from '../../src/domain/errors';
import { InventoryItemType, OwnershipType } from '../../src/domain/inventory';
import { DepotService } from '../../src/application/services/depot.service';
import { InMemoryDepotRepository } from '../support/fakes';

const FROM = new Date('2026-07-01T00:00:00.000Z');
const TO = new Date('2026-08-01T00:00:00.000Z');

class InMemoryOperationalReportRepository implements OperationalReportRepository {
  data: Awaited<ReturnType<OperationalReportRepository['load']>> = {
    sales: [],
    receivedPurchaseOrders: [],
    outflows: [],
  };

  async load() {
    return this.data;
  }
}

describe('OperationalReportService', () => {
  let repo: InMemoryOperationalReportRepository;
  let service: OperationalReportService;
  let depotId: string;

  beforeEach(async () => {
    repo = new InMemoryOperationalReportRepository();
    const depots = new InMemoryDepotRepository();
    service = new OperationalReportService(repo, depots);
    depotId = (
      await new DepotService(depots).create({
        code: 'JKT-01',
        name: 'Depot Cikini',
        ownershipType: OwnershipType.HKP,
        address: 'Jl. Air',
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
      })
    ).id;
  });

  it('uses the latest received direct-product unit cost and nulls aggregate COGS when coverage is partial', async () => {
    const itemId = randomUUID();
    repo.data = {
      sales: [
        {
          movementId: randomUUID(),
          itemId,
          itemType: InventoryItemType.PRODUK,
          label: 'Refill 19L',
          quantitySold: 3,
          occurredAt: new Date('2026-07-10T10:00:00.000Z'),
        },
        {
          movementId: randomUUID(),
          itemId: randomUUID(),
          itemType: InventoryItemType.PRODUK,
          label: 'Tanpa biaya langsung',
          quantitySold: 2,
          occurredAt: new Date('2026-07-11T10:00:00.000Z'),
        },
      ],
      receivedPurchaseOrders: [
        {
          id: randomUUID(),
          poNumber: 'PO-LATEST',
          receivedAt: new Date('2026-07-05T10:00:00.000Z'),
          lines: [
            { itemType: InventoryItemType.PRODUK, label: '  refill   19l ', quantity: 20, unitCostIdr: 4500 },
          ],
        },
        {
          id: randomUUID(),
          poNumber: 'PO-OLD',
          receivedAt: new Date('2026-07-01T10:00:00.000Z'),
          lines: [
            { itemType: InventoryItemType.PRODUK, label: 'Refill 19L', quantity: 20, unitCostIdr: 4000 },
          ],
        },
      ],
      outflows: [],
    };

    const report = await service.report(depotId, { from: FROM, to: TO });

    expect(report.cogs).toMatchObject({
      amountIdr: null,
      coveredAmountIdr: 13_500,
      totalUnits: 5,
      coveredUnits: 3,
      uncoveredUnits: 2,
      status: 'partial',
      valuationMethod: 'LATEST_RECEIVED_DIRECT_PRODUCT_COST',
    });
    expect(report.cogs.uncoveredItems).toEqual([
      expect.objectContaining({
        label: 'Tanpa biaya langsung',
        units: 2,
        reason: 'NO_MATCHING_RECEIVED_PO',
      }),
    ]);
  });

  it('marks duplicate sale labels across inventory items ambiguous instead of assigning a PO cost', async () => {
    repo.data = {
      sales: [
        {
          movementId: randomUUID(),
          itemId: randomUUID(),
          itemType: InventoryItemType.PRODUK,
          label: 'Produk A',
          quantitySold: 1,
          occurredAt: new Date('2026-07-10T10:00:00.000Z'),
        },
        {
          movementId: randomUUID(),
          itemId: randomUUID(),
          itemType: InventoryItemType.PRODUK,
          label: ' produk  a ',
          quantitySold: 2,
          occurredAt: new Date('2026-07-10T11:00:00.000Z'),
        },
      ],
      receivedPurchaseOrders: [
        {
          id: randomUUID(),
          poNumber: 'PO-1',
          receivedAt: new Date('2026-07-01T10:00:00.000Z'),
          lines: [{ itemType: InventoryItemType.PRODUK, label: 'Produk A', quantity: 10, unitCostIdr: 5000 }],
        },
      ],
      outflows: [],
    };

    const report = await service.report(depotId, { from: FROM, to: TO });

    expect(report.cogs.amountIdr).toBeNull();
    expect(report.cogs.coveredAmountIdr).toBe(0);
    expect(report.cogs.uncoveredUnits).toBe(3);
    expect(report.cogs.uncoveredItems.every((item) => item.reason === 'AMBIGUOUS_ITEM_LABEL')).toBe(true);
  });

  it('excludes only verified received-PO outflows and reports unverified PO categories transparently', async () => {
    const receivedPoId = randomUUID();
    repo.data = {
      sales: [],
      receivedPurchaseOrders: [
        { id: receivedPoId, poNumber: 'PO-VERIFIED', receivedAt: FROM, lines: [] },
      ],
      outflows: [
        { id: randomUUID(), category: ' po ', amountIdr: 100_000, sourceRef: 'PO-VERIFIED', occurredAt: FROM },
        { id: randomUUID(), category: 'PO', amountIdr: 20_000, sourceRef: 'PO-UNKNOWN', occurredAt: FROM },
        { id: randomUUID(), category: 'SEWA', amountIdr: 50_000, sourceRef: null, occurredAt: FROM },
      ],
    };

    const report = await service.report(depotId, { from: FROM, to: TO });

    expect(report.opex).toMatchObject({
      amountIdr: null,
      coveredAmountIdr: 50_000,
      status: 'partial',
      includedEntries: 1,
      excludedProcurementAmountIdr: 100_000,
      excludedProcurementEntries: 1,
      unverifiedProcurementAmountIdr: 20_000,
      unverifiedProcurementEntries: 1,
      exclusionRule: 'NORMALIZED_CATEGORY_PO_AND_RECEIVED_PO_SOURCE_REF',
    });
  });

  it('returns complete zero COGS when there are no sales and identifies the report as non-statutory', async () => {
    const report = await service.report(depotId, { from: FROM, to: TO });

    expect(report.cogs).toMatchObject({ amountIdr: 0, coveredAmountIdr: 0, status: 'complete' });
    expect(report.reportType).toBe('OPERATIONAL_MANAGEMENT');
    expect(report.disclaimer).toContain('not statutory');
  });

  it('rejects an unknown depot', async () => {
    await expect(service.report(randomUUID(), { from: FROM, to: TO })).rejects.toBeInstanceOf(
      DepotNotFoundError,
    );
  });
});
