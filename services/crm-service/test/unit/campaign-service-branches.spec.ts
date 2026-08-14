import { CampaignService } from '../../src/application/services/campaign.service';
import { NoRecipientsError } from '../../src/domain/errors';
import { RecipientStatus } from '../../src/domain/recipient-status';
import { WhatsappBroadcastPort } from '../../src/application/ports/whatsapp-broadcast.port';
import {
  FakeActivitySegment,
  FakeCustomerDirectory,
  FakeWhatsappBroadcast,
  InMemoryCampaignRepository,
} from '../support/fakes';

// Branch gap-fills for CampaignService the main spec leaves out: list() + clampPage clamping,
// the default `recipients` parameter, a recipient with no name, and a whatsapp failure that
// returns no error string (the `?? 'unknown error'` fallback).

describe('CampaignService branches', () => {
  let repo: InMemoryCampaignRepository;
  let directory: FakeCustomerDirectory;

  beforeEach(() => {
    repo = new InMemoryCampaignRepository();
    directory = new FakeCustomerDirectory();
  });

  const service = (whatsapp: WhatsappBroadcastPort): CampaignService =>
    new CampaignService(repo, whatsapp, directory, new FakeActivitySegment());

  it('uses the default (empty) recipients list, throwing NoRecipientsError', async () => {
    await expect(service(new FakeWhatsappBroadcast()).create('staff', 'Blast', 'Hi')).rejects.toBeInstanceOf(
      NoRecipientsError,
    );
  });

  it('list() clamps page and limit to the allowed range', async () => {
    const svc = service(new FakeWhatsappBroadcast());
    await svc.create('staff', 'A', 'Hi', [{ phone: '+6281' }]);
    const clamped = await svc.list(0, 500); // page<1 -> 1, limit>100 -> 100
    expect(clamped.page).toBe(1);
    expect(clamped.limit).toBe(100);
    expect(clamped.total).toBe(1);

    const defaults = await svc.list(); // default page=1, limit=20
    expect(defaults.page).toBe(1);
    expect(defaults.limit).toBe(20);
  });

  it('sends to a nameless recipient and records "unknown error" when the transport gives none', async () => {
    const whatsapp: WhatsappBroadcastPort = { send: async () => ({ ok: false }) };
    const svc = service(whatsapp);
    const created = await svc.create('staff', 'Blast', 'Hi {{name}}', [{ phone: '+6281' }]);
    await svc.send(created.id);
    await svc.processSending();
    const recipient = (await svc.get(created.id)).recipients[0];
    expect(recipient.status).toBe(RecipientStatus.FAILED);
    expect(recipient.error).toBe('unknown error');
  });
});
