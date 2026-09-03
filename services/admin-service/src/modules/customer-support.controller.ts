import { BadRequestException, Body, Controller, Get, Post, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  AuditMutationsInterceptor,
  AuthenticatedUser,
  CurrentUser,
  Role,
  Roles,
} from '@hydromart/platform';

import { SupportTicketService } from '../application/services/support-ticket.service';
import { RaiseComplaintDto, SupportTicketDto } from './dto/support-ticket.dto';

/**
 * K1.5 — the customer's own end of the support queue.
 *
 * Every verb on this table belonged to staff. `/hq/tickets` lists, replies, assigns and
 * resolves; the only way a row ever arrived was an operator typing one at the counter.
 * There was no customer-side complaint or dispute path anywhere in the app, and the
 * nearest thing — the help page — is an FAQ accordion plus a WhatsApp button that appears
 * only when the depot has filled in a contact number. A depot that has not leaves the
 * customer on a page with nothing on it that reaches a person.
 *
 * A separate controller on its own path rather than two more routes on the staff one:
 * that class carries `@Can('hqBackOffice')` for every route in it and a `GET :id` that would
 * shadow anything added beside it. Two audiences, two doors.
 *
 * Signed-in only, and that is a decision rather than an oversight. An unauthenticated
 * write here is a spam surface, and a complaint nobody can reply to is worse than none —
 * a guest with a real problem is pointed at the depot's number instead.
 */
@ApiTags('Support (customer)')
@ApiBearerAuth()
@Roles(Role.CUSTOMER)
// CA-2-67: every write below reaches the audit trail. See AuditMutationsInterceptor.
@UseInterceptors(AuditMutationsInterceptor)
@Controller({ path: 'support/tickets', version: '1' })
export class CustomerSupportController {
  constructor(private readonly tickets: SupportTicketService) {}

  @ApiOkResponse({ type: SupportTicketDto, isArray: true })
  @Get()
  @ApiOperation({ summary: "The signed-in customer's own complaints, newest first (K1.5)" })
  async mine(@CurrentUser() user: AuthenticatedUser): Promise<SupportTicketDto[]> {
    const rows = await this.tickets.listForCustomer(user.sub);
    return rows.map(SupportTicketDto.from);
  }

  @ApiOkResponse({ type: SupportTicketDto })
  @Post()
  @ApiOperation({ summary: 'Raise a complaint about an order or the service (K1.5)' })
  async raise(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RaiseComplaintDto,
  ): Promise<SupportTicketDto> {
    // The number staff will read on the console comes from the TOKEN, not the form. A
    // complainant who can type their own contact details can type somebody else's, and
    // this queue is answered by phoning whoever is on the row. A customer with no phone on
    // their account cannot be called back at all, so the complaint is refused rather than
    // filed into a queue that will answer nobody.
    if (!user.phone) {
      throw new BadRequestException(
        'Nomor HP akun belum terisi, jadi komplain ini tidak bisa dibalas. Lengkapi nomor HP dulu.',
      );
    }
    const ticket = await this.tickets.createForCustomer(user.sub, {
      subject: dto.subject,
      customerRef: user.phone,
      customerPhone: user.phone,
      orderRef: dto.orderRef ?? null,
      body: dto.body,
    });
    return SupportTicketDto.from(ticket);
  }
}
