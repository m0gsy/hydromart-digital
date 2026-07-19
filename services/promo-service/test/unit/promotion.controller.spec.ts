import { plainToInstance } from 'class-transformer';

import { PromotionController } from '../../src/modules/promotion.controller';
import { PromotionService } from '../../src/application/services/promotion.service';
import { CreatePromotionDto, UpdatePromotionDto } from '../../src/modules/dto/promotion.dto';

describe('PromotionController', () => {
  const promotions = {
    listActive: jest.fn().mockResolvedValue([{ id: 'p1' }]),
    listAll: jest.fn().mockResolvedValue([{ id: 'p1' }, { id: 'p2' }]),
    create: jest.fn().mockResolvedValue({ id: 'p3' }),
    update: jest.fn().mockResolvedValue({ id: 'p1' }),
    remove: jest.fn().mockResolvedValue(undefined),
  };
  const controller = new PromotionController(promotions as unknown as PromotionService);

  afterEach(() => jest.clearAllMocks());

  it('listActive delegates', async () => {
    await controller.listActive();
    expect(promotions.listActive).toHaveBeenCalled();
  });

  it('listAll delegates', async () => {
    await controller.listAll();
    expect(promotions.listAll).toHaveBeenCalled();
  });

  it('create maps full dto and parses dates', async () => {
    await controller.create({
      title: 'Sale',
      subtitle: 'Big',
      imageUrl: 'http://img',
      ctaLabel: 'Go',
      ctaHref: 'http://go',
      voucherCode: 'HEMAT',
      sortOrder: 5,
      startsAt: '2026-01-01T00:00:00.000Z',
      endsAt: '2026-02-01T00:00:00.000Z',
    } as unknown as CreatePromotionDto);
    expect(promotions.create).toHaveBeenCalledWith({
      title: 'Sale',
      subtitle: 'Big',
      imageUrl: 'http://img',
      ctaLabel: 'Go',
      ctaHref: 'http://go',
      voucherCode: 'HEMAT',
      sortOrder: 5,
      startsAt: new Date('2026-01-01T00:00:00.000Z'),
      endsAt: new Date('2026-02-01T00:00:00.000Z'),
    });
  });

  it('create applies null/zero fallbacks for omitted optional fields', async () => {
    await controller.create({ title: 'Bare' } as unknown as CreatePromotionDto);
    expect(promotions.create).toHaveBeenCalledWith({
      title: 'Bare',
      subtitle: null,
      imageUrl: null,
      ctaLabel: null,
      ctaHref: null,
      voucherCode: null,
      sortOrder: 0,
      startsAt: null,
      endsAt: null,
    });
  });

  it('update passes patch through and parses provided dates', async () => {
    await controller.update('id-1', {
      title: 'New',
      active: false,
      startsAt: '2026-03-01T00:00:00.000Z',
    } as unknown as UpdatePromotionDto);
    expect(promotions.update).toHaveBeenCalledWith('id-1', {
      title: 'New',
      subtitle: undefined,
      imageUrl: undefined,
      ctaLabel: undefined,
      ctaHref: undefined,
      voucherCode: undefined,
      sortOrder: undefined,
      active: false,
      startsAt: new Date('2026-03-01T00:00:00.000Z'),
      endsAt: undefined,
    });
  });

  it('remove delegates with the id', async () => {
    await controller.remove('id-9');
    expect(promotions.remove).toHaveBeenCalledWith('id-9');
  });

  it('CreatePromotionDto coerces sortOrder via @Type', () => {
    const dto = plainToInstance(CreatePromotionDto, { title: 'Sale', sortOrder: '3' });
    expect(dto.sortOrder).toBe(3);
  });
});
