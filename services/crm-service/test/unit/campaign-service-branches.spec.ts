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

  /*
   * E-2. A blank WHATSAPP_API_URL used to make the adapter log each message and report
   * success, so `result.sent` counted an audience nobody contacted — a campaign to every
   * customer reported itself fully delivered.
   *
   * The sweep now refuses before it claims anybody. Claiming and failing them would spend a
   * real audience on a missing environment variable; left PENDING they go out the moment it
   * is set. (Refusing at BOOT was the first fix and was wrong: prod compose defaults the
   * variable to empty, so it would have stopped crm-service from starting.)
   */
  it('refuses the sweep, and consumes nobody, when WhatsApp is not configured', async () => {
    const whatsapp = new FakeWhatsappBroadcast();
    const svc = service(whatsapp);
    const created = await svc.create('staff', 'Blast', 'Hi', [
      { phone: '+6281' },
      { phone: '+6282' },
    ]);
    await svc.send(created.id);
    whatsapp.isConfigured = false;

    const result = await svc.processSending();

    expect(result).toEqual({ campaigns: 0, sent: 0, failed: 0, completed: 0 });
    expect(whatsapp.sent).toHaveLength(0);

    // Nobody was burned: once configured, the same sweep delivers them.
    whatsapp.isConfigured = true;
    const after = await svc.processSending();
    expect(after.sent).toBe(2);
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
    const whatsapp: WhatsappBroadcastPort = { send: async () => ({ ok: false }), configured: () => true };
    const svc = service(whatsapp);
    const created = await svc.create('staff', 'Blast', 'Hi {{name}}', [{ phone: '+6281' }]);
    await svc.send(created.id);
    await svc.processSending();
    const recipient = (await svc.get(created.id)).recipients[0];
    expect(recipient.status).toBe(RecipientStatus.FAILED);
    expect(recipient.error).toBe('unknown error');
  });
});
