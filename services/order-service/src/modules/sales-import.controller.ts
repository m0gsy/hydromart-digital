import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import {
  AuthenticatedUser,
  Can,
  CurrentUser,
  ImportSummary,
  InternalAuthGuard,
  Public,
} from '@hydromart/platform';

import { SalesImportService } from '../application/services/sales-import.service';
import { ImportedSalesTransactionRecord } from '../application/ports/sales-import.repository';
import {
  ImportSalesTransactionsDto,
  ListImportedSalesQueryDto,
  SummaryByMethodQueryDto,
} from './dto/sales-import.dto';

/**
 * Historical sales-transaction import (items 3/11 of the 2026 evaluation list) — one-time
 * migration tooling for a depot's pre-Hydromart sales ledger. Reporting, not a live order
 * path: see the ImportedSalesTransaction model comment for why.
 */
@ApiTags('Sales import')
@ApiBearerAuth()
@Can('salesImportAdmin')
@Controller({ path: 'sales-import', version: '1' })
export class SalesImportController {
  constructor(private readonly imports: SalesImportService) {}

  @ApiOkResponse({ description: 'Per-row created/skipped(duplicate)/failed summary.' })
  @Post()
  @ApiOperation({ summary: 'Bulk-import historical sales transactions from the CSV wizard' })
  import(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ImportSalesTransactionsDto,
  ): Promise<ImportSummary> {
    return this.imports.importTransactions(user, dto.depotId, dto.rows);
  }

  @ApiOkResponse({ description: 'Imported rows for the depot within the window.' })
  @Get()
  @ApiOperation({ summary: 'List a depot’s imported historical sales transactions' })
  list(@Query() q: ListImportedSalesQueryDto): Promise<ImportedSalesTransactionRecord[]> {
    return this.imports.listByDepot(q.depotId, new Date(q.from), new Date(q.to));
  }

  /**
   * For payment-service's revenue-by-method merge (owner decision, 2026-10-02):
   * payment-service owns the live method aggregate and has no reader for a table that
   * lives in this service's own database, so it asks here under the shared internal key
   * — same shape `internal/export-rows` already answers for depot/product.
   */
  @ApiOkResponse({ description: 'Historical revenue summed per normalised payment method.' })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Get('summary-by-method')
  @ApiOperation({ summary: 'Historical revenue by payment method (internal service auth)' })
  summaryByMethod(
    @Query() q: SummaryByMethodQueryDto,
  ): Promise<{ rows: { label: string; orders: number; revenue: number }[] }> {
    return this.imports
      .sumByMethod(q.from ? new Date(q.from) : undefined, q.to ? new Date(q.to) : undefined)
      .then((sums) => ({
        rows: sums.map((s) => ({ label: s.method, orders: s.orders, revenue: s.revenue })),
      }));
  }
}
