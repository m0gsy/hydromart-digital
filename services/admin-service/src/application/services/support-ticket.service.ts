import { Inject, Injectable } from '@nestjs/common';

import { SupportTicketNotFoundError } from '../../domain/errors';
import {
  CreateSupportTicketData,
  ListSupportTicketsFilter,
  SupportTicketRecord,
  SupportTicketRepository,
} from '../ports/support-ticket.repository';
import { ADMIN_TOKENS } from '../tokens';

@Injectable()
export class SupportTicketService {
  private static readonly MINE_LIMIT = 50;
  constructor(
    @Inject(ADMIN_TOKENS.SupportTicketRepository)
    private readonly repo: SupportTicketRepository,
  ) {}

  /** Support tickets (Design 15a), newest first, optionally filtered. */
  list(filter: ListSupportTicketsFilter): Promise<SupportTicketRecord[]> {
    return this.repo.list(filter);
  }

  /**
   * Open a ticket. Staff-raised: the console is how a complaint taken at the counter or on
   * the phone enters the system, so the caller is authenticated staff and the customer is
   * named in the body. A customer-facing route is a separate decision — `/help` is static
   * today, and opening that path needs moderation, not just an endpoint.
   */
  create(data: CreateSupportTicketData): Promise<SupportTicketRecord> {
    return this.repo.create(data);
  }

  /**
   * K1.5 — the customer's own end of the same queue.
   *
   * Every verb on this table belonged to staff: the console lists, replies, assigns and
   * resolves, and the only way a row ever arrived was an operator typing one. There was no
   * customer-side complaint or dispute path anywhere in the app, and the nearest thing —
   * the help page — is an FAQ accordion plus a WhatsApp button that only appears when the
   * depot has filled in a contact number.
   *
   * The ticket is stamped with the account that raised it, which is what makes the second
   * half possible: seeing it again, with whatever staff replied. A complaint you cannot
   * follow up on is the same silence with an extra step in front of it.
   */
  createForCustomer(
    customerId: string,
    data: Omit<CreateSupportTicketData, 'customerId' | 'priority'>,
  ): Promise<SupportTicketRecord> {
    // Priority is deliberately NOT taken from the customer. Everyone's own problem is
    // urgent, so a self-selected priority sorts nothing; staff triage it from the console.
    return this.repo.create({ ...data, customerId });
  }

  /** K1.5: this customer's own tickets, newest first. Bounded — a list, not an archive. */
  listForCustomer(customerId: string): Promise<SupportTicketRecord[]> {
    return this.repo.listForCustomer(customerId, SupportTicketService.MINE_LIMIT);
  }

  /** A single ticket with its message thread. 404 when the id is unknown. */
  async get(id: string): Promise<SupportTicketRecord> {
    const ticket = await this.repo.findById(id);
    if (!ticket) throw new SupportTicketNotFoundError(id);
    return ticket;
  }

  /** Append a staff reply. 404 when the id is unknown. */
  async reply(id: string, body: string): Promise<SupportTicketRecord> {
    const updated = await this.repo.addStaffMessage(id, body);
    if (!updated) throw new SupportTicketNotFoundError(id);
    return updated;
  }

  /** Assign the ticket to a staff member. 404 when the id is unknown. */
  async assign(id: string, assigneeId: string): Promise<SupportTicketRecord> {
    const updated = await this.repo.assign(id, assigneeId);
    if (!updated) throw new SupportTicketNotFoundError(id);
    return updated;
  }

  /** Mark the ticket resolved. 404 when the id is unknown. */
  async resolve(id: string): Promise<SupportTicketRecord> {
    const updated = await this.repo.resolve(id);
    if (!updated) throw new SupportTicketNotFoundError(id);
    return updated;
  }
}
