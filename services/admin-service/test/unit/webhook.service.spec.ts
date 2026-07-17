import { WebhookNotFoundError } from '../../src/domain/errors';
import { WebhookService } from '../../src/application/services/webhook.service';
import { InMemoryWebhookRepository } from '../support/fakes';

describe('WebhookService', () => {
  let repo: InMemoryWebhookRepository;
  let service: WebhookService;

  beforeEach(() => {
    repo = new InMemoryWebhookRepository();
    service = new WebhookService(repo);
  });

  it('creates a webhook with no fabricated delivery data', async () => {
    const w = await service.create({ url: 'https://x.example.com/hooks', events: ['order.created'] });
    expect(w.active).toBe(true);
    expect(w.deliveryRatePct).toBeNull();
    expect(w.lastDeliveryStatus).toBeNull();
  });

  it('toggles active via update', async () => {
    const w = await service.create({ url: 'https://x.example.com/hooks', events: ['order.created'] });
    const off = await service.update(w.id, { active: false });
    expect(off.active).toBe(false);
  });

  it('deletes a webhook', async () => {
    const w = await service.create({ url: 'https://x.example.com/hooks', events: ['order.created'] });
    await service.remove(w.id);
    expect(await service.list()).toHaveLength(0);
  });

  it('throws WebhookNotFoundError for unknown ids', async () => {
    await expect(service.update('nope', { active: false })).rejects.toBeInstanceOf(
      WebhookNotFoundError,
    );
    await expect(service.remove('nope')).rejects.toBeInstanceOf(WebhookNotFoundError);
  });
});
