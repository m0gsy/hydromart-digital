import { Injectable } from '@nestjs/common';

import { TicketAuthorType, TicketPriority, TicketStatus } from '../../domain/ticket';
import {
  ListSupportTicketsFilter,
  SupportTicketRecord,
  SupportTicketRepository,
  TicketMessageRecord,
} from '../../application/ports/support-ticket.repository';
import { PrismaService } from './prisma.service';

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
      messages: row.messages.map((m) => this.toMessage(m)),
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
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    return rows.map((r) => this.toRecord(r));
  }

  async findById(id: string): Promise<SupportTicketRecord | null> {
    const row = await this.prisma.supportTicket.findUnique({
      where: { id },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
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
