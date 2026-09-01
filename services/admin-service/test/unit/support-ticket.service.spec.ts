import { SupportTicketNotFoundError } from '../../src/domain/errors';
import { TicketAuthorType, TicketPriority, TicketStatus } from '../../src/domain/ticket';
import { SupportTicketService } from '../../src/application/services/support-ticket.service';
import { InMemorySupportTicketRepository, makeSupportTicket } from '../support/fakes';

describe('SupportTicketService', () => {
  let repo: InMemorySupportTicketRepository;
  let service: SupportTicketService;

  beforeEach(() => {
    repo = new InMemorySupportTicketRepository();
    service = new SupportTicketService(repo);
  });

  /*
   * Audit: the tickets table could be listed, replied to, assigned and resolved — and
   * nothing anywhere could create a row in it. Every one of those verbs acted on a queue
   * that could not grow, and the console's ticket list was permanently whatever somebody
   * had inserted by hand.
   */
  it('opens a ticket with the complaint as its first message', async () => {
    const ticket = await service.create({
      subject: 'Galon bocor saat diterima',
      customerRef: 'Ibu Rina',
      customerPhone: '081234567890',
      body: 'Air tumpah di teras, galonnya retak di bagian bawah.',
    });

    expect(ticket).toMatchObject({
      subject: 'Galon bocor saat diterima',
      status: TicketStatus.OPEN,
      priority: TicketPriority.MEDIUM,
      assigneeId: null,
      orderRef: null,
    });
    // Attributed to the CUSTOMER: staff are typing down what was said to them, and a thread
    // opening with a STAFF line reads as the depot complaining to itself.
    expect(ticket.messages).toHaveLength(1);
    expect(ticket.messages[0]).toMatchObject({
      authorType: TicketAuthorType.CUSTOMER,
      body: 'Air tumpah di teras, galonnya retak di bagian bawah.',
    });
    // And it is now readable through the same routes that could only ever read.
    expect(await service.get(ticket.id)).toMatchObject({ id: ticket.id });
    expect(await service.list({})).toHaveLength(1);
  });

  it('carries an order reference and an explicit priority when given', async () => {
    const ticket = await service.create({
      subject: 'Pesanan tidak sampai',
      customerRef: 'Toko Jaya',
      customerPhone: '081200000000',
      orderRef: 'HM-260816-001',
      priority: TicketPriority.HIGH,
      body: 'Sudah dua hari belum datang.',
    });
    expect(ticket).toMatchObject({ orderRef: 'HM-260816-001', priority: TicketPriority.HIGH });
  });

  it('lists newest-first and filters by status/priority', async () => {
    repo.rows = [
      makeSupportTicket({
        subject: 'A',
        createdAt: new Date(1000),
        status: TicketStatus.OPEN,
        priority: TicketPriority.HIGH,
      }),
      makeSupportTicket({
        subject: 'B',
        createdAt: new Date(3000),
        status: TicketStatus.RESOLVED,
        priority: TicketPriority.LOW,
      }),
      makeSupportTicket({
        subject: 'C',
        createdAt: new Date(2000),
        status: TicketStatus.OPEN,
        priority: TicketPriority.HIGH,
      }),
    ];
    const all = await service.list({});
    expect(all.map((t) => t.subject)).toEqual(['B', 'C', 'A']); // newest first
    expect(await service.list({ status: TicketStatus.OPEN })).toHaveLength(2);
    expect(await service.list({ priority: TicketPriority.LOW })).toHaveLength(1);
  });

  it('appends a staff reply', async () => {
    const t = makeSupportTicket();
    repo.rows = [t];
    const updated = await service.reply(t.id, 'On it.');
    expect(updated.messages).toHaveLength(1);
    expect(updated.messages[0].authorType).toBe(TicketAuthorType.STAFF);
    expect(updated.messages[0].body).toBe('On it.');
  });

  it('assign moves OPEN → ASSIGNED and resolve marks RESOLVED', async () => {
    const t = makeSupportTicket();
    repo.rows = [t];
    const assigned = await service.assign(t.id, 'staff-1');
    expect(assigned.status).toBe(TicketStatus.ASSIGNED);
    expect(assigned.assigneeId).toBe('staff-1');
    const resolved = await service.resolve(t.id);
    expect(resolved.status).toBe(TicketStatus.RESOLVED);
  });

  it('throws SupportTicketNotFoundError for unknown ids', async () => {
    await expect(service.get('nope')).rejects.toBeInstanceOf(SupportTicketNotFoundError);
    await expect(service.reply('nope', 'x')).rejects.toBeInstanceOf(SupportTicketNotFoundError);
    await expect(service.assign('nope', 's')).rejects.toBeInstanceOf(SupportTicketNotFoundError);
    await expect(service.resolve('nope')).rejects.toBeInstanceOf(SupportTicketNotFoundError);
  });

  /*
   * UU PDP item 13 — forget one person's complaints.
   *
   * Neither `support_tickets` nor `ticket_messages` has a retention policy at all, so
   * before this endpoint nothing would EVER have removed the 14 rows `docs/AUDIT_L3.md`
   * §4.2 counted. Scrub, not delete: that a complaint happened and how it was resolved is
   * a fact about the depot; the phone number and the customer's words are the person.
   */
  it('scrubs the person from their tickets and leaves everyone else alone', async () => {
    const mine = await service.createForCustomer('cust-1', {
      subject: 'Air keruh',
      customerRef: '+628111',
      customerPhone: '+628111',
      orderRef: null,
      body: 'Galonnya keruh',
    });
    await service.createForCustomer('cust-2', {
      subject: 'Telat',
      customerRef: '+628222',
      customerPhone: '+628222',
      orderRef: null,
      body: 'Kurirnya telat',
    });

    expect(await service.erasePerson('cust-1', '+628111')).toEqual({ erased: 1 });

    const scrubbed = await service.get(mine.id);
    expect(scrubbed).toMatchObject({ customerRef: 'Pengguna dihapus', customerPhone: '-' });
    expect(scrubbed.messages[0].body).toBe('[dihapus atas permintaan pemilik data]');
    // Somebody else's complaint is untouched.
    expect(repo.rows.find((r) => r.customerId === 'cust-2')?.customerPhone).toBe('+628222');
  });
});
