import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import {
  Can,
  CurrentUser,
  AuthenticatedUser,
  assertDepotOwnership,
  ImportSummary,
  InternalAuthGuard,
  Public,
} from '@hydromart/platform';

import { GallonIssueService } from '../application/services/gallon-issue.service';
import { GallonReturnService } from '../application/services/gallon-return.service';
import { ownerIdsOf } from '../domain/depot-owners';
import { DepotService } from '../application/services/depot.service';
import {
  GallonIssueRecord,
  GallonIssueSummary,
} from '../application/ports/gallon-issue.repository';
import { Page } from '../application/pagination';
import {
  CreateGallonIssueDto,
  CreateGallonIssueFromOrderDto,
  ImportGallonBalancesDto,
  ListIssuesQueryDto,
  VoidGallonOrderDto,
} from './dto/gallon-issue.dto';
import {
  GallonIssueResponseDto,
  ImportResponseDto,
  PagedGallonIssueResponseDto,
} from './dto/responses.generated.dto';

/** Empty-gallon issues / deposit held nested under a depot (PRD Module 11c). */
@ApiTags('Gallon issues')
@ApiBearerAuth()
@Controller({ path: 'depots/:depotId/gallon-issues', version: '1' })
export class GallonIssueController {
  constructor(
    private readonly issues: GallonIssueService,
    private readonly depots: DepotService,
    private readonly returns: GallonReturnService,
  ) {}

  @ApiOkResponse({ type: ImportResponseDto })
  @Can('returnsWrite')
  @Post('import')
  @HttpCode(200)
  @ApiOperation({ summary: 'Import opening gallon balances per customer (staff)' })
  importOpening(
    @Param('depotId', ParseUUIDPipe) depotId: string,
    @Body() dto: ImportGallonBalancesDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ImportSummary> {
    return this.issues.importOpening(depotId, dto.rows, user.sub);
  }

  @ApiOkResponse({ type: GallonIssueResponseDto })
  @Can('returnsWrite')
  @Post()
  @ApiOperation({ summary: 'Record an empty-gallon issue (staff)' })
  record(
    @Param('depotId', ParseUUIDPipe) depotId: string,
    @Body() dto: CreateGallonIssueDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<GallonIssueRecord> {
    return this.issues.record(
      depotId,
      {
        customerId: dto.customerId ?? null,
        quantity: dto.quantity,
        depositHeld: dto.depositHeld,
        note: dto.note ?? null,
        idempotencyKey: dto.idempotencyKey ?? null,
      },
      user.sub,
    );
  }

  /**
   * I1: fulfilment books the empties a completed delivery carried out.
   *
   * Internal key, not a staff capability: the caller is order-service delivering its own
   * completion outbox, and it holds no user token for this depot. Declared before the
   * `summary`/list reads for the same reason they are ordered — a static segment must never
   * be readable as anything else.
   *
   * Idempotent on `orderId`, because a completion fan-out is at-least-once. A second call
   * returns the row the first wrote instead of booking a second deposit.
   */
  @ApiOkResponse({ type: GallonIssueResponseDto })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Post('internal/from-order')
  @ApiOperation({ summary: 'Book the empties a completed order carried out (internal)' })
  async recordFromOrder(
    @Param('depotId', ParseUUIDPipe) depotId: string,
    @Body() dto: CreateGallonIssueFromOrderDto,
  ): Promise<GallonIssueRecord> {
    const record = await this.issues.recordFromOrder(
      depotId,
      { orderId: dto.orderId, customerId: dto.customerId ?? null, quantity: dto.quantity },
      'order-service',
    );
    // HD-6 (#24-A): a counter refill takes the empty back at the till as it hands the full
    // gallon out. Booked AFTER the issue so the return is measured against a balance that
    // already holds the new gallon; both writes are idempotent on the order, so the
    // outbox's retry of a half-done call finishes it instead of doubling it.
    if (dto.emptiesReturned && dto.emptiesReturned > 0) {
      await this.returns.recordFromCounter(
        depotId,
        {
          orderId: dto.orderId,
          customerId: dto.customerId ?? null,
          quantity: Math.min(dto.emptiesReturned, dto.quantity),
        },
        'order-service',
      );
    }
    return record;
  }

  /**
   * HD-6 (#24-A): a counter sale was voided, so the gallons it booked go back (the issue and,
   * for a refill, the return). Idempotent: a retried void reverses once.
   */
  @ApiOkResponse({ description: 'Which ledgers this call reversed' })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @HttpCode(200)
  @Post('internal/void-order')
  @ApiOperation({ summary: "Reverse a voided counter sale's gallon movements (internal)" })
  voidOrder(
    @Param('depotId', ParseUUIDPipe) depotId: string,
    @Body() dto: VoidGallonOrderDto,
  ): Promise<{ reversedIssue: boolean; reversedReturn: boolean }> {
    return this.returns.reverseOrder(depotId, dto.orderId, 'order-service');
  }

  // Static `summary` segment declared before the paginated list so the route is unambiguous.
  @ApiOkResponse({ type: GallonIssueResponseDto })
  @Can('returnsRead')
  @Get('summary')
  @ApiOperation({ summary: "A depot's issue totals (count, gallons, deposit held)" })
  async summary(
    @Param('depotId', ParseUUIDPipe) depotId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<GallonIssueSummary> {
    assertDepotOwnership(user, ownerIdsOf(await this.depots.get(depotId, false)));
    return this.issues.summary(depotId);
  }

  @ApiOkResponse({ type: PagedGallonIssueResponseDto })
  @Can('returnsRead')
  @Get()
  @ApiOperation({ summary: "List a depot's gallon issues (paginated, newest first)" })
  async list(
    @Param('depotId', ParseUUIDPipe) depotId: string,
    @Query() query: ListIssuesQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Page<GallonIssueRecord>> {
    assertDepotOwnership(user, ownerIdsOf(await this.depots.get(depotId, false)));
    return this.issues.list(depotId, query.page ?? 1, query.limit ?? 20);
  }
}
