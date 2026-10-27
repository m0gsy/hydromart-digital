import { Inject, Injectable } from '@nestjs/common';

import { InventoryRepository } from '../ports/inventory.repository';
import { DEPOT_TOKENS } from '../tokens';

export type ReportColumnType = 'text' | 'int' | 'money' | 'date' | 'percent';

/** The shape admin-service renders into a scheduled report file. */
export interface ReportTable {
  columns: { key: string; label: string; type: ReportColumnType }[];
  rows: (string | number | null)[][];
  truncated: boolean;
}

/**
 * Tables for admin-service's scheduled reports that depot-service owns the data for.
 *
 * Only the stock snapshot lives here: the water-meter readings sit in another service's
 * database, and fetching them from this one would put a second owner on that data.
 */
@Injectable()
export class ReportTableService {
  /** A scheduled file is a spreadsheet, not a data dump: past this it says so and stops. */
  static readonly ROW_CAP = 5000;

  constructor(
    @Inject(DEPOT_TOKENS.InventoryRepository) private readonly inventory: InventoryRepository,
  ) {}

  /**
   * Stock per depot and line, AS OF NOW. A quantity is a running counter with no history of
   * its own, so a past `to` cannot be answered honestly; the report states the current
   * position and the date of the last movement instead.
   */
  async stockLevels(): Promise<ReportTable> {
    const cap = ReportTableService.ROW_CAP;
    const found = await this.inventory.stockSnapshot(cap + 1);
    const lines = found.slice(0, cap);
    return {
      columns: [
        { key: 'depot', label: 'Depot', type: 'text' },
        { key: 'item', label: 'Barang', type: 'text' },
        { key: 'unit', label: 'Satuan', type: 'text' },
        { key: 'quantity', label: 'Stok', type: 'int' },
        { key: 'reserved', label: 'Tertahan', type: 'int' },
        { key: 'available', label: 'Tersedia', type: 'int' },
        { key: 'minimum', label: 'Stok minimum', type: 'int' },
        { key: 'status', label: 'Status', type: 'text' },
        { key: 'lastMovementAt', label: 'Gerakan terakhir', type: 'date' },
      ],
      rows: lines.map((l) => {
        const available = l.quantity - l.reserved;
        return [
          `${l.depotCode} · ${l.depotName}`,
          l.label,
          l.unit,
          l.quantity,
          l.reserved,
          available,
          l.minimumStock,
          available <= 0 ? 'HABIS' : available <= l.minimumStock ? 'RENDAH' : 'AMAN',
          l.lastMovementAt ? l.lastMovementAt.toISOString() : null,
        ];
      }),
      truncated: found.length > cap,
    };
  }
}
