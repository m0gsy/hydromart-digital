import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Role, Roles } from '@hydromart/platform';

import { SupportTicketService } from '../application/services/support-ticket.service';
import {
  AssignTicketDto,
  ReplyTicketDto,
  SupportTicketDto,
  SupportTicketQueryDto,
} from './dto/support-ticket.dto';

// Design 15a — support tickets. HEAD_OFFICE + SUPER_ADMIN. Read (filter status/priority,
// newest-first) + reply / assign / resolve. Threads live in child ticket_messages.
@ApiTags('Support tickets')
@ApiBearerAuth()
@Roles(Role.HEAD_OFFICE, Role.SUPER_ADMIN)
@Controller({ path: 'tickets', version: '1' })
export class SupportTicketsController {
  constructor(private readonly tickets: SupportTicketService) {}

  @Get()
  @ApiOperation({ summary: 'List support tickets (15a, newest first, filterable)' })
  async list(@Query() query: SupportTicketQueryDto): Promise<SupportTicketDto[]> {
    const rows = await this.tickets.list({ status: query.status, priority: query.priority });
    return rows.map(SupportTicketDto.from);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one ticket with its message thread' })
  async get(@Param('id') id: string): Promise<SupportTicketDto> {
    return SupportTicketDto.from(await this.tickets.get(id));
  }

  @Post(':id/reply')
  @ApiOperation({ summary: 'Append a staff reply to a ticket' })
  async reply(@Param('id') id: string, @Body() dto: ReplyTicketDto): Promise<SupportTicketDto> {
    return SupportTicketDto.from(await this.tickets.reply(id, dto.body));
  }

  @Post(':id/assign')
  @ApiOperation({ summary: 'Assign a ticket to a staff member' })
  async assign(@Param('id') id: string, @Body() dto: AssignTicketDto): Promise<SupportTicketDto> {
    return SupportTicketDto.from(await this.tickets.assign(id, dto.assigneeId));
  }

  @Post(':id/resolve')
  @ApiOperation({ summary: 'Mark a ticket resolved' })
  async resolve(@Param('id') id: string): Promise<SupportTicketDto> {
    return SupportTicketDto.from(await this.tickets.resolve(id));
  }
}
