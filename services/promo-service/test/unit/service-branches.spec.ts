import { PromotionNotFoundError } from '../../src/domain/errors';
import { PromotionService } from '../../src/application/services/promotion.service';
import { InMemoryPromotionRepository, InMemoryVoucherRepository } from '../support/fakes';
import { PromoConfigService } from '../../src/config/promo-config.service';

/** Only `businessTimeZone` is read; WIB pinned so a UTC-bucket regression (H-16) fails here. */
const promoTestConfig = (timeZone = 'Asia/Jakarta'): PromoConfigService =>
  ({ businessTimeZone: timeZone }) as PromoConfigService;

class FakeOrderValues {
  async findOrderValues(): Promise<{ orderId: string; totalIdr: number }[] | null> {
    return [];
  }
}

const basePromotion = () => ({
  title: 'Promo',
  subtitle: null,
  imageUrl: null,
  ctaLabel: null,
  ctaHref: null,
  voucherCode: null,
  sortOrder: 0,
  startsAt: null,
  endsAt: null,
});

describe('PromotionService branch gaps', () => {
  let repo: InMemoryPromotionRepository;
  let service: PromotionService;

  beforeEach(() => {
    repo = new InMemoryPromotionRepository();
    service = new PromotionService(
      repo,
      new InMemoryVoucherRepository(),
      new FakeOrderValues() as never,
      promoTestConfig(),
    );
  });

  it('listAll returns every promotion incl. inactive', async () => {
    const created = await service.create(basePromotion());
    await service.update(created.id, { active: false });
    const all = await service.listAll();
    expect(all.map((p) => p.id)).toContain(created.id);
  });

  it('remove deletes an existing promotion', async () => {
    const created = await service.create(basePromotion());
    await service.remove(created.id);
    expect(await service.listAll()).toHaveLength(0);
  });

  it('remove throws for a missing promotion', async () => {
    await expect(service.remove('missing')).rejects.toBeInstanceOf(PromotionNotFoundError);
  });
});
