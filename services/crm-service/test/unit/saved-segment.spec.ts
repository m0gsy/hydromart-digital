import { NotFoundException } from '@nestjs/common';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { SavedSegmentService } from '../../src/application/services/saved-segment.service';
import { SavedSegmentPrismaRepository } from '../../src/infrastructure/prisma/saved-segment.prisma.repository';
import { SavedSegmentController } from '../../src/modules/saved-segment.controller';
import { SaveSegmentDto, SavedSegmentDto } from '../../src/modules/dto/saved-segment.dto';
import { InMemorySavedSegmentRepository } from '../support/fakes';

/*
 * "Buat segment" could compose conditions, size them live and hand them to the campaign
 * builder — and nothing could be saved, so the same audience was rebuilt by hand every
 * time somebody wanted to message it again.
 */
describe('SavedSegmentService', () => {
  let repo: InMemorySavedSegmentRepository;
  let service: SavedSegmentService;

  beforeEach(() => {
    repo = new InMemorySavedSegmentRepository();
    service = new SavedSegmentService(repo);
  });

  it('saves a segment and lists it back newest first', async () => {
    await service.save('staff-1', 'Berisiko', { lapsedDays: 60 });
    await service.save('staff-1', 'Sering beli', { minOrders: 5 });
    expect((await service.list()).map((s) => s.name)).toEqual(['Sering beli', 'Berisiko']);
  });

  /*
   * Saving the same name twice is one person refining one audience. Two rows would be how
   * two people end up messaging different lists while believing they picked the same one.
   */
  it('upserts by name rather than creating a second audience with the same label', async () => {
    const first = await service.save('staff-1', 'Berisiko', { lapsedDays: 60 });
    const again = await service.save('staff-2', 'Berisiko', { lapsedDays: 90 });
    expect(again.id).toBe(first.id);
    expect(again.conditions).toEqual({ lapsedDays: 90 });
    expect(await service.list()).toHaveLength(1);
  });

  it('trims the name so " Berisiko" and "Berisiko" are the same audience', async () => {
    await service.save('staff-1', 'Berisiko', { lapsedDays: 60 });
    await service.save('staff-1', '  Berisiko  ', { lapsedDays: 30 });
    expect(await service.list()).toHaveLength(1);
  });

  it('deletes a segment, and 404s on one that is not there', async () => {
    const saved = await service.save('staff-1', 'Berisiko', {});
    await expect(service.remove(saved.id)).resolves.toBeUndefined();
    await expect(service.remove(saved.id)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('SavedSegmentPrismaRepository', () => {
  const model = {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    upsert: jest.fn(),
    delete: jest.fn(),
  };
  const repo = new SavedSegmentPrismaRepository({ savedSegment: model } as never);
  const row = () => ({
    id: 'seg-1',
    name: 'Berisiko',
    conditions: { lapsedDays: 60 },
    createdBy: 'staff-1',
    createdAt: new Date('2026-08-01'),
    updatedAt: new Date('2026-08-01'),
  });

  beforeEach(() => jest.clearAllMocks());

  it('lists newest first, bounded', async () => {
    model.findMany.mockResolvedValue([row()]);
    const out = await repo.list(200);
    expect(model.findMany).toHaveBeenCalledWith({ orderBy: { createdAt: 'desc' }, take: 200 });
    expect(out[0].conditions).toEqual({ lapsedDays: 60 });
  });

  // A row written before a condition existed reads as `null` rather than an object; an
  // empty filter is the honest reading of "no conditions", not a crash on the next `.tier`.
  it('reads a null conditions column as an empty filter', async () => {
    model.findMany.mockResolvedValue([{ ...row(), conditions: null }]);
    expect((await repo.list(10))[0].conditions).toEqual({});
  });

  it('finds one by id, null on miss', async () => {
    model.findUnique.mockResolvedValue(row());
    expect((await repo.findById('seg-1'))?.name).toBe('Berisiko');
    model.findUnique.mockResolvedValue(null);
    expect(await repo.findById('nope')).toBeNull();
  });

  /*
   * ONE statement. A read-then-write pair would let two concurrent saves of the same name
   * both pass the check and leave the unique index to reject the loser with a 500.
   */
  it('upserts by name in a single statement', async () => {
    model.upsert.mockResolvedValue(row());
    await repo.upsertByName({ name: 'Berisiko', conditions: { lapsedDays: 60 }, createdBy: 's1' });
    expect(model.upsert).toHaveBeenCalledWith({
      where: { name: 'Berisiko' },
      create: { name: 'Berisiko', conditions: { lapsedDays: 60 }, createdBy: 's1' },
      update: { conditions: { lapsedDays: 60 }, createdBy: 's1' },
    });
  });

  it('guards existence before deleting', async () => {
    model.findUnique.mockResolvedValue(row());
    expect(await repo.remove('seg-1')).toBe(true);
    expect(model.delete).toHaveBeenCalledWith({ where: { id: 'seg-1' } });
    model.findUnique.mockResolvedValue(null);
    expect(await repo.remove('gone')).toBe(false);
  });
});

describe('SavedSegmentController', () => {
  const segments = { list: jest.fn(), save: jest.fn(), remove: jest.fn() };
  const controller = new SavedSegmentController(segments as never);
  const user = { sub: 'staff-1' } as never;
  const record = {
    id: 'seg-1',
    name: 'Berisiko',
    conditions: { lapsedDays: 60 },
    createdBy: 'staff-1',
    createdAt: new Date('2026-08-01'),
    updatedAt: new Date('2026-08-01'),
  };

  beforeEach(() => jest.clearAllMocks());

  it('lists mapped segments', async () => {
    segments.list.mockResolvedValue([record]);
    expect(await controller.list()).toEqual([SavedSegmentDto.from(record)]);
  });

  it('saves under the calling staff id', async () => {
    segments.save.mockResolvedValue(record);
    await controller.save(user, {
      name: 'Berisiko',
      conditions: { lapsedDays: 60 },
    } as SaveSegmentDto);
    expect(segments.save).toHaveBeenCalledWith('staff-1', 'Berisiko', { lapsedDays: 60 });
  });

  it('delegates the delete', async () => {
    await controller.remove('seg-1');
    expect(segments.remove).toHaveBeenCalledWith('seg-1');
  });
});

// K1.9 (same shape): @ValidateNested() alone lets a body with no `conditions` through, and the
// controller then saves `undefined` as the audience definition — a 500 for a malformed request.
describe('SaveSegmentDto', () => {
  it('rejects a body with no conditions instead of saving undefined', async () => {
    const errors = await validate(plainToInstance(SaveSegmentDto, { name: 'Berisiko' }));
    expect(errors.map((e) => e.property)).toContain('conditions');
  });
});
