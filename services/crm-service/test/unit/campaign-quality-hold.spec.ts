import { ServiceUnavailableException } from '@nestjs/common';

import { CampaignService } from '../../src/application/services/campaign.service';
import { CampaignStatus } from '../../src/domain/campaign-status';
import { CampaignDepotOnHoldError } from '../../src/domain/errors';
import { RecipientStatus } from '../../src/domain/recipient-status';
import { HeldDepotsHttpAdapter } from '../../src/infrastructure/http/held-depots.http.adapter';
import {
  FakeActivitySegment,
  FakeBroadcastDelivery,
  FakeCustomerDirectory,
  FakeHeldDepots,
  InMemoryCampaignRepository,
} from '../support/fakes';

/** HD-14: a depot on a quality hold makes no campaign, sends none, and a network-wide one skips its customers. */
const D1 = '00000000-0000-4000-8000-0000000000d1';
const D2 = '00000000-0000-4000-8000-0000000000d2';

describe('campaigns and quality hold (HD-14)', () => {
  let repo: InMemoryCampaignRepository;
  let delivery: FakeBroadcastDelivery;
  let directory: FakeCustomerDirectory;
  let activity: FakeActivitySegment;
  let holds: FakeHeldDepots;
  let service: CampaignService;
  const people = [
    { customerId: 'c1', phone: '+6281', name: 'Andi' },
    { customerId: 'c2', phone: '+6282', name: 'Budi' },
  ];

  beforeEach(() => {
    repo = new InMemoryCampaignRepository();
    delivery = new FakeBroadcastDelivery();
    directory = new FakeCustomerDirectory();
    activity = new FakeActivitySegment();
    holds = new FakeHeldDepots();
    service = new CampaignService(repo, delivery, directory, activity, holds);
  });

  const seedDirectory = () => {
    directory.recipients = people.map((p) => ({ ...p })) as never;
    activity.customerIds = ['c1', 'c2'];
  };

  it('refuses to create a depot campaign, and an AI draft, for a held depot', async () => {
    seedDirectory();
    holds.held.add(D1);
    await expect(service.createForDepot('staff', D1, 'Promo', 'Hi')).rejects.toBeInstanceOf(CampaignDepotOnHoldError);
    await expect(
      service.draftFromAi('ai', D1, { name: 'Promo', messageTemplate: 'Hi' }, { suggestionId: '00000000-0000-4000-8000-0000000000a1', reason: 'x' }),
    ).rejects.toBeInstanceOf(CampaignDepotOnHoldError);
    expect(repo.campaigns).toHaveLength(0);
    // another depot is untouched, and the campaign remembers its depot
    const ok = await service.createForDepot('staff', D2, 'Promo', 'Hi');
    expect(ok.depotId).toBe(D2);
  });

  it('refuses to send a draft whose depot went on hold after it was made, and sends it after the hold', async () => {
    seedDirectory();
    const draft = await service.createForDepot('staff', D1, 'Promo', 'Hi');
    holds.held.add(D1);
    await expect(service.send(draft.id)).rejects.toBeInstanceOf(CampaignDepotOnHoldError);
    await expect(service.sendOwn(draft.id, 'staff')).rejects.toBeInstanceOf(CampaignDepotOnHoldError);
    expect((await service.get(draft.id)).status).toBe(CampaignStatus.DRAFT);
    holds.held.clear();
    expect((await service.send(draft.id)).status).toBe(CampaignStatus.SENDING);
  });

  it('sends a network-wide draft even when some depot is held (its customers are skipped later)', async () => {
    seedDirectory();
    const wide = await service.create('hq', 'Semua', 'Hi', people);
    holds.held.add(D1);
    expect((await service.send(wide.id)).status).toBe(CampaignStatus.SENDING);
  });

  it('leaves a held depot campaign waiting mid-send, and finishes it after the hold', async () => {
    seedDirectory();
    const draft = await service.createForDepot('staff', D1, 'Promo', 'Hi');
    await service.send(draft.id);
    holds.held.add(D1);
    const waiting = await service.processSending();
    expect(waiting.campaigns).toBe(0);
    expect(delivery.sent).toHaveLength(0);
    expect((await service.get(draft.id)).recipients.every((r) => r.status === RecipientStatus.PENDING)).toBe(true);
    holds.held.clear();
    expect((await service.processSending()).sent).toBe(2);
  });

  it('does not let held campaigns fill the sweep batch: five held ones older than a healthy one, which is still sent', async () => {
    seedDirectory();
    for (let i = 0; i < 5; i += 1) {
      const held = await service.createForDepot('staff', D1, `Held ${i}`, 'Hi');
      await service.send(held.id);
    }
    const ok = await service.createForDepot('staff', D2, 'Healthy', 'Hi');
    await service.send(ok.id);
    holds.held.add(D1);
    const out = await service.processSending();
    expect(out).toMatchObject({ campaigns: 1, sent: 2 });
    expect((await service.get(ok.id)).status).toBe(CampaignStatus.SENT);
  });

  it('a network-wide send skips the customers of a held depot and reaches the rest', async () => {
    const wide = await service.create('hq', 'Semua', 'Hi', people);
    await service.send(wide.id);
    holds.held.add(D1);
    activity.customerIds = ['c1']; // c1 ordered at the held depot
    const out = await service.processSending();
    expect(out).toMatchObject({ sent: 1, skipped: 1 });
    expect(activity.lastConditions).toEqual({ depotId: D1 });
    const rows = (await service.get(wide.id)).recipients;
    expect(rows.find((r) => r.customerId === 'c1')?.status).toBe(RecipientStatus.SKIPPED);
    expect(rows.find((r) => r.customerId === 'c2')?.status).toBe(RecipientStatus.SENT);
  });

  it('answers 503 for a create or a send, and sends nothing in a sweep, when the holds cannot be read', async () => {
    seedDirectory();
    const draft = await service.createForDepot('staff', D1, 'Promo', 'Hi');
    holds.fail = true;
    await expect(service.createForDepot('staff', D1, 'Promo 2', 'Hi')).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(service.send(draft.id)).rejects.toBeInstanceOf(ServiceUnavailableException);
    holds.fail = false;
    await service.send(draft.id);
    holds.fail = true;
    expect(await service.processSending()).toMatchObject({ campaigns: 0, sent: 0, ok: false });
    expect(delivery.sent).toHaveLength(0);
    // an empty sweep never asks (nothing to hold back)
    const other = new CampaignService(new InMemoryCampaignRepository(), delivery, directory, activity, holds);
    expect((await other.processSending()).ok).toBe(true);
  });

  it('a network-wide send with a failing customer read waits too', async () => {
    const wide = await service.create('hq', 'Semua', 'Hi', people);
    await service.send(wide.id);
    holds.held.add(D1);
    activity.down = true;
    expect((await service.processSending()).ok).toBe(false);
  });
});

describe('HeldDepotsHttpAdapter', () => {
  const adapter = (url: string | null) => new HeldDepotsHttpAdapter({ depotServiceUrl: url } as never);
  const reply = (body: unknown, ok = true, status = 200) =>
    jest.spyOn(global, 'fetch').mockResolvedValue({ ok, status, json: async () => body } as Response);
  afterEach(() => jest.restoreAllMocks());

  it('collects the ids whose qualityHold is active, across pages', async () => {
    const spy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ items: [{ id: 'a', qualityHold: { active: true } }, { id: 'b' }], totalPages: 2 }) } as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ items: [{ id: 'c', qualityHold: { active: false } }, { id: 'd', qualityHold: { active: true } }] }) } as Response);
    expect([...(await adapter('http://d').heldDepotIds())]).toEqual(['a', 'd']);
    expect(spy.mock.calls[0][0]).toBe('http://d/api/v1/depots?limit=100&page=1');
  });

  it('throws on a missing url, a bad status, a malformed page or row', async () => {
    await expect(adapter(null).heldDepotIds()).rejects.toThrow('missing');
    reply({}, false, 500);
    await expect(adapter('http://d').heldDepotIds()).rejects.toThrow('500');
    reply({ items: 'x' });
    await expect(adapter('http://d').heldDepotIds()).rejects.toThrow('malformed');
    reply({ items: [{ id: 5 }] });
    await expect(adapter('http://d').heldDepotIds()).rejects.toThrow('malformed');
  });
});
