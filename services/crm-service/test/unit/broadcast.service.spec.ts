import { BroadcastService } from '../../src/application/services/broadcast.service';
import { BroadcastLevel } from '../../src/domain/broadcast-level';
import { BroadcastNotFoundError } from '../../src/domain/errors';
import { InMemoryBroadcastRepository } from '../support/fakes';

describe('BroadcastService', () => {
  let repo: InMemoryBroadcastRepository;
  let service: BroadcastService;

  let announce: jest.Mock;

  beforeEach(() => {
    repo = new InMemoryBroadcastRepository();
    announce = jest.fn();
    service = new BroadcastService(repo, { announceToDepotStaff: announce } as never);
  });

  // CRM-09: an URGENT broadcast used to be pull-only - the courier learned of it by opening the
  // inbox. It now also wakes the depot's staff; calmer levels stay quiet.
  it('pushes an URGENT broadcast to the depot staff, and only that level', async () => {
    await service.create('ops-1', 'depot-1', 'Jalan ditutup', 'Putar balik', BroadcastLevel.URGENT);
    expect(announce).toHaveBeenCalledWith('depot-1', 'Jalan ditutup', 'Putar balik');
    announce.mockClear();
    await service.create('ops-1', 'depot-1', 'Info', 'x', BroadcastLevel.INFO);
    await service.create('ops-1', 'depot-1', 'Jadwal', 'x', BroadcastLevel.SCHEDULED);
    expect(announce).not.toHaveBeenCalled();
  });

  it('still posts the broadcast when no notifier is wired', async () => {
    const bare = new BroadcastService(repo);
    const b = await bare.create('ops-1', 'depot-1', 'Urgent', 'x', BroadcastLevel.URGENT);
    expect(b.level).toBe('URGENT');
  });

  it('posts a broadcast scoped to a depot', async () => {
    const b = await service.create('ops-1', 'depot-1', 'Jalan ditutup', 'Detail...', BroadcastLevel.URGENT);
    expect(b).toMatchObject({ depotId: 'depot-1', level: 'URGENT', createdBy: 'ops-1' });
  });

  it('posts a SCHEDULED ("Terjadwal") broadcast', async () => {
    const b = await service.create('ops-1', 'depot-1', 'Perawatan tangki', 'Besok pagi', BroadcastLevel.SCHEDULED);
    expect(b.level).toBe('SCHEDULED');
  });

  it('lists only the courier depot broadcasts, newest first, with read flags', async () => {
    await service.create('ops-1', 'depot-1', 'A', 'a');
    await service.create('ops-1', 'depot-1', 'B', 'b');
    await service.create('ops-1', 'depot-2', 'Other', 'x');

    const list = await service.listForCourier('depot-1', 'courier-1');
    expect(list.map((b) => b.title)).toEqual(['B', 'A']);
    expect(list.every((b) => b.readAt === null)).toBe(true);
  });

  it('marks a broadcast read for one courier only', async () => {
    const b = await service.create('ops-1', 'depot-1', 'A', 'a');
    await service.markRead(b.id, 'courier-1');

    const mine = await service.listForCourier('depot-1', 'courier-1');
    expect(mine[0].readAt).not.toBeNull();
    const other = await service.listForCourier('depot-1', 'courier-2');
    expect(other[0].readAt).toBeNull();
  });

  it('rejects marking an unknown broadcast read', async () => {
    await expect(service.markRead('11111111-1111-1111-1111-111111111111', 'courier-1')).rejects.toBeInstanceOf(
      BroadcastNotFoundError,
    );
  });
});
