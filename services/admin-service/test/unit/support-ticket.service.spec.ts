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

  it('lists newest-first and filters by status/priority', async () => {
    repo.rows = [
      makeSupportTicket({ subject: 'A', createdAt: new Date(1000), status: TicketStatus.OPEN, priority: TicketPriority.HIGH }),
      makeSupportTicket({ subject: 'B', createdAt: new Date(3000), status: TicketStatus.RESOLVED, priority: TicketPriority.LOW }),
      makeSupportTicket({ subject: 'C', createdAt: new Date(2000), status: TicketStatus.OPEN, priority: TicketPriority.HIGH }),
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
});
