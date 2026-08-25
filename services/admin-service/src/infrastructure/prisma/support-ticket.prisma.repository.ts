import { Injectable } from '@nestjs/common';

import { TicketAuthorType, TicketPriority, TicketStatus } from '../../domain/ticket';
import {
  CreateSupportTicketData,
  ListSupportTicketsFilter,
  SupportTicketRecord,
  SupportTicketRepository,
  TicketMessageRecord,
} from '../../application/ports/support-ticket.repository';
import { PrismaService } from './prisma.service';

/**
 * A ticket thread is nested inside its ticket, and a Prisma middleware cannot see a nested
 * include — so the whole conversation loaded with every ticket, on the LIST route too
 * (audit H-47). Newest-first with a cap, reversed by the mapper: the console shows the tail
 * of the conversation, which is the part anyone reads.
 */
const THREAD_TAIL = { orderBy: { createdAt: 'desc' }, take: 50 } as const;

interface TicketMessageRow {
  id: string;
  ticketId: string;
  authorType: string;
  body: string;
  createdAt: Date;
}

interface SupportTicketRow {
  id: string;
  subject: string;
  customerRef: string;
  customerPhone: string;
  orderRef: string | null;
  customerId: string | null;
  priority: string;
  status: string;
  assigneeId: string | null;
  createdAt: Date;
  messages: TicketMessageRow[];
}

@Injectable()
export class SupportTicketPrismaRepository implements SupportTicketRepository {
  constructor(private readonly prisma: PrismaService) {}

  private toMessage(row: TicketMessageRow): TicketMessageRecord {
    return { ...row, authorType: row.authorType as TicketAuthorType };
  }

  private toRecord(row: SupportTicketRow): SupportTicketRecord {
    return {
      ...row,
      priority: row.priority as TicketPriority,
      status: row.status as TicketStatus,
      // THREAD_TAIL reads newest-first so the cap keeps the RECENT messages; the reversal
      // hands the caller back the chronological order it has always seen.
      messages: [...row.messages].reverse().map((m) => this.toMessage(m)),
    };
  }

  async list(filter: ListSupportTicketsFilter): Promise<SupportTicketRecord[]> {
    const where = {
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.priority ? { priority: filter.priority } : {}),
    };
    const rows = await this.prisma.supportTicket.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { messages: THREAD_TAIL },
    });
    return rows.map((r) => this.toRecord(r));
  }

  /** K1.5: this customer's own tickets, scoped by id and nothing else. */
  async listForCustomer(customerId: string, limit: number): Promise<SupportTicketRecord[]> {
    const rows = await this.prisma.supportTicket.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { messages: THREAD_TAIL },
    });
    return rows.map((r) => this.toRecord(r));
  }

  async create(data: CreateSupportTicketData): Promise<SupportTicketRecord> {
    // One transaction: a ticket that exists without its complaint is a subject line, and
    // the thread view would render it as an empty conversation nobody can answer.
    const created = await this.prisma.supportTicket.create({
      data: {
        subject: data.subject,
        customerRef: data.customerRef,
        customerPhone: data.customerPhone,
        orderRef: data.orderRef ?? null,
        customerId: data.customerId ?? null,
        ...(data.priority ? { priority: data.priority } : {}),
        messages: { create: { authorType: TicketAuthorType.CUSTOMER, body: data.body } },
      },
      include: { messages: THREAD_TAIL },
    });
    return this.toRecord(created);
  }

  async findById(id: string): Promise<SupportTicketRecord | null> {
    const row = await this.prisma.supportTicket.findUnique({
      where: { id },
      include: { messages: THREAD_TAIL },
    });
    return row ? this.toRecord(row) : null;
  }

  async addStaffMessage(id: string, body: string): Promise<SupportTicketRecord | null> {
    const existing = await this.prisma.supportTicket.findUnique({ where: { id } });
    if (!existing) return null;
    await this.prisma.ticketMessage.create({
      data: { ticketId: id, authorType: TicketAuthorType.STAFF, body },
    });
    return this.findById(id);
  }

  async assign(id: string, assigneeId: string): Promise<SupportTicketRecord | null> {
    const existing = await this.prisma.supportTicket.findUnique({ where: { id } });
    if (!existing) return null;
    await this.prisma.supportTicket.update({
      where: { id },
      data: { assigneeId, status: TicketStatus.ASSIGNED },
    });
    return this.findById(id);
  }

  async resolve(id: string): Promise<SupportTicketRecord | null> {
    const existing = await this.prisma.supportTicket.findUnique({ where: { id } });
    if (!existing) return null;
    await this.prisma.supportTicket.update({
      where: { id },
      data: { status: TicketStatus.RESOLVED },
    });
    return this.findById(id);
  }
}
