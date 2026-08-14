import { ReportDataset } from '../../domain/report-dataset';

/** One line of a rendered report. Every dataset flattens to this so the file has one shape. */
export interface ReportRow {
  label: string;
  orders: number;
  revenue: number;
}

/**
 * Fetches the rows behind a scheduled report from whichever service owns them
 * (order-service for depot/product, payment-service for method).
 *
 * Implementations THROW rather than return an empty list on failure. An empty report is a
 * real answer — a depot that sold nothing has no rows — so a service that could not be
 * reached must not be able to produce one. The sweep records that run as FAILED instead,
 * and `hq/exports` shows the failure rather than an empty spreadsheet nobody questions.
 */
export interface ReportSourcePort {
  rowsFor(dataset: ReportDataset, from: Date, to: Date): Promise<ReportRow[]>;
}
