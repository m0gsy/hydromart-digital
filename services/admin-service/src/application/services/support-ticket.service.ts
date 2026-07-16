import { Inject, Injectable } from '@nestjs/common';

import { SupportTicketNotFoundError } from '../../domain/errors';
import {
  ListSupportTicketsFilter,
  SupportTicketRecord,
  SupportTicketRepository,
} from '../ports/support-ticket.repository';
import { ADMIN_TOKENS } from '../tokens';

@Injectable()
export class SupportTicketService {
  constructor(
    @Inject(ADMIN_TOKENS.SupportTicketRepository)
    private readonly repo: SupportTicketRepository,
  ) {}

  /** Support tickets (Design 15a), newest first, optionally filtered. */
  list(filter: ListSupportTicketsFilter): Promise<SupportTicketRecord[]> {
    return this.repo.list(filter);
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
