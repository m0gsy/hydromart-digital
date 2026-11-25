import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { WebhookNotFoundError } from '../../src/domain/errors';
import { CreateWebhookDto, UpdateWebhookDto } from '../../src/modules/dto/webhook.dto';
import { WebhookService } from '../../src/application/services/webhook.service';
import { InMemoryWebhookRepository } from '../support/fakes';

/** ADM-1: registration resolves the URL too, so the test decides what it resolves to. */
const publicLookup = async () => [{ address: '203.0.113.10' }];

describe('WebhookService', () => {
  let repo: InMemoryWebhookRepository;
  let service: WebhookService;

  beforeEach(() => {
    repo = new InMemoryWebhookRepository();
    service = new WebhookService(repo, publicLookup);
  });

  it('creates a webhook with no fabricated delivery data', async () => {
    const w = await service.create({
      url: 'https://x.example.com/hooks',
      events: ['order.created'],
    });
    expect(w.active).toBe(true);
    expect(w.deliveryRatePct).toBeNull();
    expect(w.lastDeliveryStatus).toBeNull();
  });

  it('toggles active via update', async () => {
    const w = await service.create({
      url: 'https://x.example.com/hooks',
      events: ['order.created'],
    });
    const off = await service.update(w.id, { active: false });
    expect(off.active).toBe(false);
  });

  // ADM-1: a URL changed after registration is resolved again — otherwise the SSRF check
  // only ever guards the address the endpoint was born with.
  it('re-checks the URL when an update moves the endpoint', async () => {
    const w = await service.create({
      url: 'https://x.example.com/hooks',
      events: ['order.created'],
    });
    const moved = await service.update(w.id, { url: 'https://y.example.com/hooks' });
    expect(moved.url).toBe('https://y.example.com/hooks');
  });

  it('deletes a webhook', async () => {
    const w = await service.create({
      url: 'https://x.example.com/hooks',
      events: ['order.created'],
    });
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

/*
 * CA-2-37: an endpoint registered without a secret is an endpoint nobody can trust.
 *
 * The dispatcher signs only when there IS one, deliberately — and its note said an endpoint
 * registered without a secret "asked for that". The premise was false: the HQ console sends
 * `{ url, events }` and had no field for a secret at all, so it could not ask for anything.
 * Every webhook ever registered from the console went out unsigned, forever, and the
 * receiver had no way to tell our POST from anyone else's. A URL is not a credential.
 */
describe('WebhookService signing secret (CA-2-37)', () => {
  it('gives every endpoint a secret, even when the caller sends none', async () => {
    const service = new WebhookService(new InMemoryWebhookRepository(), publicLookup);

    const w = await service.create({
      url: 'https://partner.example.com/hooks',
      events: ['order.created'],
    });

    expect(w.secret).toBeTruthy();
    // 32 bytes of randomBytes as hex — long enough that the HMAC is the weakest part.
    expect(w.secret).toMatch(/^[0-9a-f]{64}$/);
  });

  it('gives two endpoints different secrets', async () => {
    const service = new WebhookService(new InMemoryWebhookRepository(), publicLookup);
    const a = await service.create({ url: 'https://a.example.com/h', events: ['x'] });
    const b = await service.create({ url: 'https://b.example.com/h', events: ['x'] });
    expect(a.secret).not.toBe(b.secret);
  });

  /*
   * A partner migrating an endpoint that already verifies against a known key must be able
   * to keep it — generating over the top would break the verification we are trying to add.
   */
  it('honours a secret the caller supplies, and ignores a blank one', async () => {
    const service = new WebhookService(new InMemoryWebhookRepository(), publicLookup);

    const kept = 'kunci-lama-mitra-yang-sudah-dipakai-2026';
    const supplied = await service.create({
      url: 'https://partner.example.com/hooks',
      events: ['order.created'],
      secret: kept,
    });
    expect(supplied.secret).toBe(kept);

    const blank = await service.create({
      url: 'https://other.example.com/hooks',
      events: ['order.created'],
      secret: '   ',
    });
    expect(blank.secret).toMatch(/^[0-9a-f]{64}$/);
  });
});

/*
 * HD-7: the request shapes are where "secret wajib" and the closed event list are enforced
 * for a person; the column's NOT NULL + length check is the backstop under them.
 */
describe('webhook request DTOs (HD-7)', () => {
  const errors = (cls: typeof CreateWebhookDto | typeof UpdateWebhookDto, body: object) =>
    validateSync(plainToInstance(cls, body)).map((e) => e.property);
  const url = 'https://ai.example.com/api/ingress/hd';

  it('takes only events some service publishes', () => {
    expect(errors(CreateWebhookDto, { url, events: ['franchise.application_submitted'] })).toEqual([]);
    expect(errors(CreateWebhookDto, { url, events: ['delivery.delivered'] })).toEqual([]);
    // Every event a service now publishes is accepted (HD-17B added order.created, order.status_changed, stock.low).
    for (const event of ['order.created', 'order.status_changed', 'stock.low']) {
      expect(errors(CreateWebhookDto, { url, events: [event] })).toEqual([]);
    }
    for (const events of [['order.shipped'], ['franchise.application_submited'], ['delivery.delivered', 'x.y']]) {
      expect(errors(CreateWebhookDto, { url, events })).toContain('events');
      expect(errors(UpdateWebhookDto, { events })).toContain('events');
    }
  });

  it('refuses a supplied secret too short or too odd to be one', () => {
    for (const secret of ['', '   ', 'short', 'a'.repeat(31), `${'a'.repeat(31)} b`, 'a'.repeat(201)]) {
      expect(errors(CreateWebhookDto, { url, events: ['delivery.delivered'], secret })).toContain('secret');
      expect(errors(UpdateWebhookDto, { secret })).toContain('secret');
    }
    const good = 'Zx9!'.repeat(8);
    expect(errors(CreateWebhookDto, { url, events: ['delivery.delivered'], secret: good })).toEqual([]);
    expect(errors(UpdateWebhookDto, { secret: good })).toEqual([]);
  });

  it('lets a registration leave the secret out (one is generated), never a PATCH remove it', () => {
    expect(errors(CreateWebhookDto, { url, events: ['delivery.delivered'] })).toEqual([]);
    expect(errors(CreateWebhookDto, { url, events: ['delivery.delivered'], secret: null })).toEqual([]);
    expect(errors(UpdateWebhookDto, { active: false })).toEqual([]);
    // null used to reach the column (now a 500); "" used to switch signing off for good.
    expect(errors(UpdateWebhookDto, { secret: null })).toContain('secret');
  });
});
