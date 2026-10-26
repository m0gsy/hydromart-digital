import { ReportDataset } from '../../domain/report-dataset';
import { ReportTable, RevenueRow } from '../../domain/report-table';

/** One line of the legacy revenue report. */
export type ReportRow = RevenueRow;

export interface ReportWindow {
  from: Date;
  to: Date;
}

/**
 * Fetches what a scheduled report renders from whichever service owns the data.
 *
 * Implementations THROW rather than return an empty table on failure. An empty report is a
 * real answer — a depot that sold nothing has no rows — so a service that could not be
 * reached must not be able to produce one. The sweep records that run as FAILED instead,
 * and `hq/exports` shows the failure rather than an empty spreadsheet nobody questions.
 */
export interface ReportSourcePort {
  rowsFor(dataset: ReportDataset, from: Date, to: Date): Promise<ReportRow[]>;
  /**
   * The finished table for a dataset. `previous` is the period before this one, used by the
   * revenue datasets for their comparison columns and ignored by the rest.
   */
  tableFor(
    dataset: ReportDataset,
    from: Date,
    to: Date,
    previous?: ReportWindow,
  ): Promise<ReportTable>;
}
