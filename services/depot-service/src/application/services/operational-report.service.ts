import { Inject, Injectable } from '@nestjs/common';

import { DepotNotFoundError } from '../../domain/errors';
import { DepotRepository } from '../ports/depot.repository';
import {
  OperationalReportRange,
  OperationalReportRepository,
  ReceivedPurchaseOrderCostInput,
  SaleCostInput,
} from '../ports/operational-report.repository';
import { DEPOT_TOKENS } from '../tokens';

export type CogsCoverageStatus = 'complete' | 'partial';
export type CogsUncoveredReason =
  | 'NO_MATCHING_RECEIVED_PO'
  | 'AMBIGUOUS_ITEM_LABEL'
  | 'AMBIGUOUS_PO_COST';

export interface OperationalCostReport {
  depotId: string;
  from: string;
  to: string;
  reportType: 'OPERATIONAL_MANAGEMENT';
  disclaimer: string;
  cogs: {
    amountIdr: number | null;
    coveredAmountIdr: number;
    totalUnits: number;
    coveredUnits: number;
    uncoveredUnits: number;
    status: CogsCoverageStatus;
    valuationMethod: 'LATEST_RECEIVED_DIRECT_PRODUCT_COST';
    uncoveredItems: {
      itemId: string;
      itemType: string;
      label: string;
      units: number;
      reason: CogsUncoveredReason;
    }[];
  };
  opex: {
    amountIdr: number | null;
    coveredAmountIdr: number;
    status: CogsCoverageStatus;
    includedEntries: number;
    excludedProcurementAmountIdr: number;
    excludedProcurementEntries: number;
    unverifiedProcurementAmountIdr: number;
    unverifiedProcurementEntries: number;
    exclusionRule: 'NORMALIZED_CATEGORY_PO_AND_RECEIVED_PO_SOURCE_REF';
  };
}

const normalize = (value: string): string => value.trim().replace(/\s+/g, ' ').toLowerCase();
const itemKey = (item: Pick<SaleCostInput, 'itemType' | 'label'>): string =>
  `${item.itemType}\u0000${normalize(item.label)}`;

@Injectable()
export class OperationalReportService {
  constructor(
    @Inject(DEPOT_TOKENS.OperationalReportRepository)
    private readonly reports: OperationalReportRepository,
    @Inject(DEPOT_TOKENS.DepotRepository) private readonly depots: DepotRepository,
  ) {}

  async report(depotId: string, range: OperationalReportRange): Promise<OperationalCostReport> {
    if (!(await this.depots.findById(depotId, false))) throw new DepotNotFoundError();

    const input = await this.reports.load(depotId, range);
    const receivedPurchaseOrders = [...input.receivedPurchaseOrders].sort(
      (a, b) =>
        a.receivedAt.getTime() - b.receivedAt.getTime() || a.poNumber.localeCompare(b.poNumber),
    );
    const saleItemIdsByKey = new Map<string, Set<string>>();
    for (const sale of input.sales) {
      const key = itemKey(sale);
      const ids = saleItemIdsByKey.get(key) ?? new Set<string>();
      ids.add(sale.itemId);
      saleItemIdsByKey.set(key, ids);
    }

    let coveredAmountIdr = 0;
    let coveredUnits = 0;
    const uncovered = new Map<
      string,
      OperationalCostReport['cogs']['uncoveredItems'][number]
    >();

    const addUncovered = (sale: SaleCostInput, reason: CogsUncoveredReason): void => {
      const key = `${sale.itemId}\u0000${reason}`;
      const current = uncovered.get(key);
      if (current) current.units += sale.quantitySold;
      else
        uncovered.set(key, {
          itemId: sale.itemId,
          itemType: sale.itemType,
          label: sale.label,
          units: sale.quantitySold,
          reason,
        });
    };

    for (const sale of input.sales) {
      const key = itemKey(sale);
      if ((saleItemIdsByKey.get(key)?.size ?? 0) > 1) {
        addUncovered(sale, 'AMBIGUOUS_ITEM_LABEL');
        continue;
      }

      const match = OperationalReportService.latestDirectCost(receivedPurchaseOrders, sale);
      if (match === null) {
        addUncovered(sale, 'NO_MATCHING_RECEIVED_PO');
        continue;
      }
      if (match === 'ambiguous') {
        addUncovered(sale, 'AMBIGUOUS_PO_COST');
        continue;
      }
      coveredUnits += sale.quantitySold;
      coveredAmountIdr += sale.quantitySold * match;
    }

    const totalUnits = input.sales.reduce((sum, sale) => sum + sale.quantitySold, 0);
    const uncoveredUnits = totalUnits - coveredUnits;
    const cogsComplete = uncoveredUnits === 0;

    const receivedRefs = new Set<string>();
    for (const po of input.receivedPurchaseOrders) {
      receivedRefs.add(po.id);
      receivedRefs.add(po.poNumber);
    }
    let coveredOpexIdr = 0;
    let includedEntries = 0;
    let excludedProcurementAmountIdr = 0;
    let excludedProcurementEntries = 0;
    let unverifiedProcurementAmountIdr = 0;
    let unverifiedProcurementEntries = 0;
    for (const outflow of input.outflows) {
      const isPoCategory = normalize(outflow.category) === 'po';
      const sourceRef = outflow.sourceRef?.trim() ?? '';
      const verifiedPo = isPoCategory && sourceRef.length > 0 && receivedRefs.has(sourceRef);
      if (verifiedPo) {
        excludedProcurementAmountIdr += outflow.amountIdr;
        excludedProcurementEntries += 1;
        continue;
      }
      if (isPoCategory) {
        unverifiedProcurementAmountIdr += outflow.amountIdr;
        unverifiedProcurementEntries += 1;
        continue;
      }
      coveredOpexIdr += outflow.amountIdr;
      includedEntries += 1;
    }

    return {
      depotId,
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      reportType: 'OPERATIONAL_MANAGEMENT',
      disclaimer:
        'Operational management report only; not statutory accounting or a tax statement.',
      cogs: {
        amountIdr: cogsComplete ? coveredAmountIdr : null,
        coveredAmountIdr,
        totalUnits,
        coveredUnits,
        uncoveredUnits,
        status: cogsComplete ? 'complete' : 'partial',
        valuationMethod: 'LATEST_RECEIVED_DIRECT_PRODUCT_COST',
        uncoveredItems: [...uncovered.values()],
      },
      opex: {
        amountIdr: unverifiedProcurementEntries === 0 ? coveredOpexIdr : null,
        coveredAmountIdr: coveredOpexIdr,
        status: unverifiedProcurementEntries === 0 ? 'complete' : 'partial',
        includedEntries,
        excludedProcurementAmountIdr,
        excludedProcurementEntries,
        unverifiedProcurementAmountIdr,
        unverifiedProcurementEntries,
        exclusionRule: 'NORMALIZED_CATEGORY_PO_AND_RECEIVED_PO_SOURCE_REF',
      },
    };
  }

  private static latestDirectCost(
    purchaseOrders: ReceivedPurchaseOrderCostInput[],
    sale: SaleCostInput,
  ): number | null | 'ambiguous' {
    const key = itemKey(sale);
    for (let index = purchaseOrders.length - 1; index >= 0; index -= 1) {
      const po = purchaseOrders[index];
      if (po.receivedAt > sale.occurredAt) continue;
      const costs = new Set(
        po.lines
          .filter((line) => itemKey(line) === key)
          .map((line) => line.unitCostIdr),
      );
      if (costs.size === 0) continue;
      if (costs.size > 1) return 'ambiguous';
      return [...costs][0];
    }
    return null;
  }
}
