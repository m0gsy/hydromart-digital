import { BadRequestException } from '@nestjs/common';

import { Role } from '@hydromart/platform';

import { SupportTicketNotFoundError } from '../../src/domain/errors';
import { TicketAuthorType, TicketStatus } from '../../src/domain/ticket';
import { SupportTicketService } from '../../src/application/services/support-ticket.service';
import { CustomerSupportController } from '../../src/modules/customer-support.controller';
import { SupportTicketPrismaRepository } from '../../src/infrastructure/prisma/support-ticket.prisma.repository';
import { InMemorySupportTicketRepository } from '../support/fakes';

/**
 * AAS-12: the customer ticket was one-way, unmeasured and not idempotent.
 *  - a customer could create and list, never answer;
 *  - nothing recorded WHEN staff first answered or WHEN it was resolved, so MTTR was
 *    uncountable;
 *  - a double-tapped "Kirim" filed the same complaint twice;
 *  - resolve had no origin-status guard, so a second resolve rewrote history.
 */
describe('AAS-12 · support ticket service', () => {
  const me = { sub: 'c-1', role: Role.CUSTOMER, phone: '+6281', depotId: null };
  let repo: InMemorySupportTicketRepository;
  let service: SupportTicketService;
  let controller: CustomerSupportController;

  beforeEach(() => {
    repo = new InMemorySupportTicketRepository();
    service = new SupportTicketService(repo);
    controller = new CustomerSupportController(service);
  });

  const raise = (over: Record<string, unknown> = {}) =>
    controller.raise(me as never, { subject: 'Galon bocor', body: 'Bocor.', ...over } as never);

  describe('customer reply', () => {
    it('appends the customer’s own message to their own ticket', async () => {
      const t = await raise();
      const after = await controller.replyToMine(me as never, t.id, { body: 'Masih belum datang.' });
      expect(after.messages).toHaveLength(2);
      expect(after.messages[1]).toMatchObject({
        authorType: TicketAuthorType.CUSTOMER,
        body: 'Masih belum datang.',
      });
    });

    it('answers 404 for somebody else’s ticket, exactly as for an unknown one', async () => {
      const t = await raise();
      const stranger = { ...me, sub: 'c-2' };
      await expect(
        controller.replyToMine(stranger as never, t.id, { body: 'x' }),
      ).rejects.toBeInstanceOf(SupportTicketNotFoundError);
      await expect(
        controller.replyToMine(me as never, 'nope', { body: 'x' }),
      ).rejects.toBeInstanceOf(SupportTicketNotFoundError);
    });

    it('refuses a reply on a resolved ticket and says to open a new one', async () => {
      const t = await raise();
      await service.resolve(t.id, 'staff-1');
      await expect(
        controller.replyToMine(me as never, t.id, { body: 'x' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('timestamps', () => {
    it('stamps firstResponseAt on the first staff reply only', async () => {
      const t = await raise();
      expect(t.firstResponseAt).toBeNull();
      const first = await service.reply(t.id, 'Kami cek.');
      expect(first.firstResponseAt).toBeInstanceOf(Date);
      const stamped = first.firstResponseAt!;
      const second = await service.reply(t.id, 'Sudah dikirim ulang.');
      expect(second.firstResponseAt).toBe(stamped);
    });

    it('a customer message does not count as a response', async () => {
      const t = await raise();
      const after = await controller.replyToMine(me as never, t.id, { body: 'Halo?' });
      expect(after.firstResponseAt).toBeNull();
    });

    it('resolve stamps resolvedAt and who, and a second resolve rewrites nothing', async () => {
      const t = await raise();
      const done = await service.resolve(t.id, 'staff-1');
      expect(done).toMatchObject({ status: TicketStatus.RESOLVED, resolvedBy: 'staff-1' });
      expect(done.resolvedAt).toBeInstanceOf(Date);
      const again = await service.resolve(t.id, 'staff-2');
      expect(again.resolvedBy).toBe('staff-1');
      expect(again.resolvedAt).toBe(done.resolvedAt);
    });
  });

  describe('create idempotency', () => {
    it('the same key from the same customer is one ticket', async () => {
      const a = await raise({ idempotencyKey: 'k-1' });
      const b = await raise({ idempotencyKey: 'k-1' });
      expect(b.id).toBe(a.id);
      expect(repo.rows).toHaveLength(1);
    });

    it('another customer’s identical key is a different ticket, and no key is never deduped', async () => {
      await raise({ idempotencyKey: 'k-1' });
      await controller.raise({ ...me, sub: 'c-2' } as never, {
        subject: 'Galon bocor',
        body: 'Bocor.',
        idempotencyKey: 'k-1',
      } as never);
      await raise();
      await raise();
      expect(repo.rows).toHaveLength(4);
    });
  });
});

describe('AAS-12 · SupportTicketPrismaRepository', () => {
  const now = new Date('2026-11-08T10:00:00.000Z');
  const supportTicket = {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    create: jest.fn(),
  };
  const ticketMessage = { create: jest.fn() };
  const repo = new SupportTicketPrismaRepository({ supportTicket, ticketMessage } as never);
  const row = (over: Record<string, unknown> = {}) => ({
    id: 't-1',
    subject: 's',
    customerRef: 'c',
    customerPhone: '+62',
    orderRef: null,
    depotRef: null,
    customerId: 'c-1',
    priority: 'MEDIUM',
    status: 'OPEN',
    assigneeId: null,
    createdAt: now,
    firstResponseAt: null,
    resolvedAt: null,
    resolvedBy: null,
    messages: [],
    ...over,
  });

  beforeEach(() => jest.clearAllMocks());

  it('addStaffMessage stamps firstResponseAt only where it is still empty', async () => {
    supportTicket.findUnique.mockResolvedValue(row());
    await repo.addStaffMessage('t-1', 'hi');
    expect(supportTicket.updateMany).toHaveBeenCalledWith({
      where: { id: 't-1', firstResponseAt: null },
      data: { firstResponseAt: expect.any(Date) },
    });
  });

  it('addCustomerMessage writes a CUSTOMER message and stamps nothing', async () => {
    supportTicket.findUnique.mockResolvedValue(row());
    await repo.addCustomerMessage('t-1', 'halo');
    expect(ticketMessage.create).toHaveBeenCalledWith({
      data: { ticketId: 't-1', authorType: TicketAuthorType.CUSTOMER, body: 'halo' },
    });
    expect(supportTicket.updateMany).not.toHaveBeenCalled();
  });

  it('resolve is guarded on the origin status and records who and when', async () => {
    supportTicket.findUnique.mockResolvedValue(row({ status: 'RESOLVED' }));
    await repo.resolve('t-1', 'staff-1');
    expect(supportTicket.updateMany).toHaveBeenCalledWith({
      where: { id: 't-1', status: { not: TicketStatus.RESOLVED } },
      data: { status: TicketStatus.RESOLVED, resolvedAt: expect.any(Date), resolvedBy: 'staff-1' },
    });
  });

  it('create with a key returns the existing ticket without writing', async () => {
    supportTicket.findFirst.mockResolvedValue(row());
    const t = await repo.create({
      subject: 's',
      customerRef: 'c',
      customerPhone: '+62',
      customerId: 'c-1',
      idempotencyKey: 'k-1',
      body: 'b',
    });
    expect(t.id).toBe('t-1');
    expect(supportTicket.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { customerId: 'c-1', idempotencyKey: 'k-1' } }),
    );
    expect(supportTicket.create).not.toHaveBeenCalled();
  });

  it('create with a key stores it, and re-reads when the unique index wins a race', async () => {
    supportTicket.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(row());
    supportTicket.create.mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' }));
    const t = await repo.create({
      subject: 's',
      customerRef: 'c',
      customerPhone: '+62',
      customerId: 'c-1',
      idempotencyKey: 'k-1',
      body: 'b',
    });
    expect(supportTicket.create.mock.calls[0][0].data.idempotencyKey).toBe('k-1');
    expect(t.id).toBe('t-1');
  });

  it('create without a key never looks one up', async () => {
    supportTicket.create.mockResolvedValue(row());
    await repo.create({ subject: 's', customerRef: 'c', customerPhone: '+62', body: 'b' });
    expect(supportTicket.findFirst).not.toHaveBeenCalled();
    expect(supportTicket.create.mock.calls[0][0].data.idempotencyKey).toBeNull();
  });

  it('create rethrows anything that is not the unique-key race', async () => {
    supportTicket.findFirst.mockResolvedValue(null);
    supportTicket.create.mockRejectedValue(new Error('db down'));
    await expect(
      repo.create({
        subject: 's',
        customerRef: 'c',
        customerPhone: '+62',
        customerId: 'c-1',
        idempotencyKey: 'k-1',
        body: 'b',
      }),
    ).rejects.toThrow('db down');
  });
});
