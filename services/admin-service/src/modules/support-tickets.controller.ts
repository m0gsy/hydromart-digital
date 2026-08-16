import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Can } from '@hydromart/platform';

import { SupportTicketService } from '../application/services/support-ticket.service';
import {
  AssignTicketDto,
  CreateTicketDto,
  ReplyTicketDto,
  SupportTicketDto,
  SupportTicketQueryDto,
} from './dto/support-ticket.dto';

// Design 15a — support tickets. HEAD_OFFICE + SUPER_ADMIN. Read (filter status/priority,
// newest-first) + reply / assign / resolve. Threads live in child ticket_messages.
@ApiTags('Support tickets')
@ApiBearerAuth()
@Can('hqConsole')
@Controller({ path: 'tickets', version: '1' })
export class SupportTicketsController {
  constructor(private readonly tickets: SupportTicketService) {}

  @ApiOkResponse({ type: SupportTicketDto, isArray: true })
  @Get()
  @ApiOperation({ summary: 'List support tickets (15a, newest first, filterable)' })
  async list(@Query() query: SupportTicketQueryDto): Promise<SupportTicketDto[]> {
    const rows = await this.tickets.list({ status: query.status, priority: query.priority });
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
