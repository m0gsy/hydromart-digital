import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { AuditMutationsInterceptor, Can, InternalAuthGuard, Public } from '@hydromart/platform';

import { SupportTicketService } from '../application/services/support-ticket.service';
import { PdpErasedResponseDto } from './dto/responses.generated.dto';
import {
  AssignTicketDto,
  CreateTicketDto,
  CreateTicketFromDepotDto,
  ReplyTicketDto,
  SupportTicketDto,
  PdpAnonymiseDto,
  SupportTicketQueryDto,
} from './dto/support-ticket.dto';

// Design 15a — support tickets. HEAD_OFFICE + SUPER_ADMIN. Read (filter status/priority,
// newest-first) + reply / assign / resolve. Threads live in child ticket_messages.
@ApiTags('Support tickets')
@ApiBearerAuth()
@Can('hqBackOffice')
// CA-2-67: every write below reaches the audit trail. See AuditMutationsInterceptor.
@UseInterceptors(AuditMutationsInterceptor)
@Controller({ path: 'tickets', version: '1' })
export class SupportTicketsController {
  constructor(private readonly tickets: SupportTicketService) {}

  /*
   * UU PDP item 13 — forget one person's complaints.
   *
   * `@Public()` + InternalAuthGuard, which OVERRIDES the class-level `@Can('hqBackOffice')`:
   * the caller is auth-service's erasure registry with the shared internal key, not a
   * console session. Neither `support_tickets` nor `ticket_messages` has a retention
   * policy at all, so before this endpoint nothing would ever have removed the 14 rows
   * `docs/AUDIT_L3.md` §4.2 counted.
   */
  @ApiOkResponse({ type: PdpErasedResponseDto })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Post('internal/pdp-anonymise')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Scrub one person from the ticket queue (internal, UU PDP)' })
  pdpAnonymise(@Body() dto: PdpAnonymiseDto): Promise<{ erased: number }> {
    return this.tickets.erasePerson(dto.customerId, dto.phone ?? null);
  }

  /*
   * CA-2-58 — the depot's end of the same complaint.
   *
   * `@Public()` + InternalAuthGuard, which OVERRIDES the class-level `@Can('hqBackOffice')`:
   * the caller is depot-service mirroring an incident a depot operator recorded, not an HQ
   * session. A depot operator has no `hqBackOffice` capability and should not need one to
   * make head office aware of a complaint against their own depot.
   *
   * Before this, the two records could not meet: head office kept `support_tickets`, the
   * depot kept a CUSTOMER_CONFLICT incident, and nothing linked them — so a complaint taken
   * at the depot counter was invisible upstairs, and the customer's follow-up depended on
   * whoever happened to be standing there.
   */
  @ApiOkResponse({ type: SupportTicketDto })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Post('internal/from-depot')
  @ApiOperation({ summary: 'Mirror a depot complaint into the HQ queue (internal, CA-2-58)' })
  async createFromDepot(@Body() dto: CreateTicketFromDepotDto): Promise<SupportTicketDto> {
    return SupportTicketDto.from(
      await this.tickets.create({
        subject: dto.subject,
        customerRef: dto.customerRef,
        customerPhone: dto.customerPhone,
        depotRef: dto.depotRef,
        orderRef: dto.orderRef ?? null,
        body: dto.body,
      }),
    );
  }

  @ApiOkResponse({ type: SupportTicketDto, isArray: true })
  @Get()
  @ApiOperation({ summary: 'List support tickets (15a, newest first, filterable)' })
  async list(@Query() query: SupportTicketQueryDto): Promise<SupportTicketDto[]> {
    const rows = await this.tickets.list({
      status: query.status,
      priority: query.priority,
      depotRef: query.depotRef,
    });
    return rows.map(SupportTicketDto.from);
  }

  /*
   * Audit: this route did not exist. `/hq/tickets` could list, reply, assign and resolve,
   * and nothing anywhere could open a ticket — the table only ever held rows put there by
   * hand, so every one of those verbs acted on a queue that could not grow.
   *
   * Staff-raised, on a customer's behalf: the console is where a complaint taken at the
   * counter or on the phone enters the system. Declared before ':id' so the static wins.
   */
  @ApiOkResponse({ type: SupportTicketDto })
  @Post()
  @ApiOperation({ summary: 'Open a support ticket on a customer behalf (15a)' })
  async create(@Body() dto: CreateTicketDto): Promise<SupportTicketDto> {
    return SupportTicketDto.from(await this.tickets.create(dto));
  }

  @ApiOkResponse({ type: SupportTicketDto })
  @Get(':id')
  @ApiOperation({ summary: 'Get one ticket with its message thread' })
  async get(@Param('id') id: string): Promise<SupportTicketDto> {
    return SupportTicketDto.from(await this.tickets.get(id));
  }

  @ApiOkResponse({ type: SupportTicketDto })
  @Post(':id/reply')
  @ApiOperation({ summary: 'Append a staff reply to a ticket' })
  async reply(@Param('id') id: string, @Body() dto: ReplyTicketDto): Promise<SupportTicketDto> {
    return SupportTicketDto.from(await this.tickets.reply(id, dto.body));
  }

  @ApiOkResponse({ type: SupportTicketDto })
  @Post(':id/assign')
  @ApiOperation({ summary: 'Assign a ticket to a staff member' })
  async assign(@Param('id') id: string, @Body() dto: AssignTicketDto): Promise<SupportTicketDto> {
    return SupportTicketDto.from(await this.tickets.assign(id, dto.assigneeId));
  }

  @ApiOkResponse({ type: SupportTicketDto })
  @Post(':id/resolve')
  @ApiOperation({ summary: 'Mark a ticket resolved' })
  async resolve(@Param('id') id: string): Promise<SupportTicketDto> {
    return SupportTicketDto.from(await this.tickets.resolve(id));
  }
}
