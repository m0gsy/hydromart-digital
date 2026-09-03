import { BadRequestException } from '@nestjs/common';

import { Role } from '@hydromart/platform';

import { SupportTicketService } from '../../src/application/services/support-ticket.service';
import { CustomerSupportController } from '../../src/modules/customer-support.controller';
import { TicketAuthorType, TicketPriority } from '../../src/domain/ticket';
import { InMemorySupportTicketRepository } from '../support/fakes';

/**
 * K1.5 — there was no customer-side complaint or dispute path anywhere in the app.
 *
 * The support table has existed since design 15a and every verb on it belonged to staff:
 * `/hq/tickets` lists, replies, assigns and resolves, and the only way a row ever arrived
 * was an operator typing one at the counter. The nearest thing a customer had was the help
 * page — an FAQ accordion, plus a WhatsApp button that appears only when their depot has
 * filled in a contact number.
 */
describe('K1.5 · a customer can complain, and can see it again', () => {
  const customer = { sub: 'c-1', role: Role.CUSTOMER, phone: '+6281234567890', depotId: null };
  const other = { sub: 'c-2', role: Role.CUSTOMER, phone: '+6289999999999', depotId: null };

  let repo: InMemorySupportTicketRepository;
  let service: SupportTicketService;
  let controller: CustomerSupportController;

  beforeEach(() => {
    repo = new InMemorySupportTicketRepository();
    service = new SupportTicketService(repo);
    controller = new CustomerSupportController(service);
  });

  const raise = (user: typeof customer, over: Record<string, unknown> = {}) =>
    controller.raise(
      user as never,
      {
        subject: 'Galon bocor',
        body: 'Galonnya sudah bocor waktu diterima.',
        ...over,
      } as never,
    );

  it('files the complaint as the customer own first message', async () => {
    const ticket = await raise(customer);

    expect(ticket.subject).toBe('Galon bocor');
    expect(ticket.messages).toHaveLength(1);
    // Staff replying to a thread whose opening line is attributed to staff reads as the
    // depot complaining to itself.
    expect(ticket.messages[0]!.authorType).toBe(TicketAuthorType.CUSTOMER);
  });

  /*
   * The contact details come from the TOKEN. Somebody who can type their own can type
   * somebody else's, and this queue is answered by phoning whoever is on the row.
   */
  it('takes the phone from the token, not from anything the form could carry', async () => {
    await raise(customer, { customerPhone: '+6280000000000', customerRef: 'Bukan Saya' });

    expect(repo.rows[0]).toMatchObject({
      customerPhone: '+6281234567890',
      customerRef: '+6281234567890',
      customerId: 'c-1',
    });
  });

  /*
   * Everyone's own problem is urgent, so a self-selected priority sorts nothing. Staff
   * triage from the console; the customer cannot jump the queue by asking to.
   */
  it('does not let the complainant set their own priority', async () => {
    await raise(customer, { priority: TicketPriority.HIGH });

    expect(repo.rows[0]!.priority).toBe(TicketPriority.MEDIUM);
  });

  it('keeps the order reference when the complaint is about one', async () => {
    await raise(customer, { orderRef: 'HM-260816-001' });

    expect(repo.rows[0]!.orderRef).toBe('HM-260816-001');
  });

  it('leaves it null when the complaint is about the service rather than an order', async () => {
    await raise(customer);

    expect(repo.rows[0]!.orderRef).toBeNull();
  });

  /*
   * A complaint filed by somebody nobody can call back is the same silence with an extra
   * step in front of it, so it is refused rather than queued.
   */
  it('refuses a complaint from an account with no phone on it', async () => {
    await expect(raise({ ...customer, phone: null } as never)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(repo.rows).toHaveLength(0);
  });

  describe('seeing it again', () => {
    it('hands back this customer own complaints, newest first', async () => {
      await raise(customer, { subject: 'Pertama' });
      await raise(customer, { subject: 'Kedua' });

      const mine = await controller.mine(customer as never);

      expect(mine.map((t) => t.subject)).toEqual(['Kedua', 'Pertama']);
    });

    it('never hands back somebody else complaint', async () => {
      await raise(other, { subject: 'Punya orang lain' });

      expect(await controller.mine(customer as never)).toEqual([]);
    });

    /*
     * Scoped by customerId and nothing else. Matching on phone number would hand somebody
     * every complaint ever filed from a number they now hold.
     */
    it('does not match on a shared phone number', async () => {
      await raise({ ...other, phone: customer.phone } as never);

      expect(await controller.mine(customer as never)).toEqual([]);
    });

    /*
     * A ticket staff typed at the counter has no account behind it — `customerRef` is free
     * text precisely because that person often has none. Those rows belong to nobody's
     * "my complaints" list and must not leak into one.
     */
    it('leaves staff-raised tickets out of everybody list', async () => {
      await service.create({
        subject: 'Diketik di kasir',
        customerRef: 'Ibu Rina',
        customerPhone: '+6281234567890',
        body: 'Complaint taken at the counter.',
      });

      expect(await controller.mine(customer as never)).toEqual([]);
      // ...while remaining perfectly visible to staff.
      expect(await service.list({})).toHaveLength(1);
    });
  });
});
