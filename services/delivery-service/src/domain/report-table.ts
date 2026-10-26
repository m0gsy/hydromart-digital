/** Datasets served by `settlements/internal/report-table` to admin-service's scheduled reports. */
export enum DeliveryReportDataset {
  COD_UNSETTLED = 'COD_UNSETTLED',
  FAILED_DELIVERIES = 'FAILED_DELIVERIES',
}

/** Most rows one report table carries; the read asks for one more to know it was cut. */
export const REPORT_TABLE_ROW_CAP = 5000;

export type ReportColumnType = 'text' | 'int' | 'money' | 'date' | 'percent';

/** The shape every service's `report-table` answers, so admin renders any dataset the same way. */
export interface ReportTable {
  columns: { key: string; label: string; type: ReportColumnType }[];
  rows: (string | number | null)[][];
  truncated: boolean;
}
