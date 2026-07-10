import { randomUUID } from 'node:crypto';

import { CampaignStatus } from '../../src/domain/campaign-status';
import { RecipientStatus } from '../../src/domain/recipient-status';
import {
  CampaignNotDraftError,
  CampaignNotFoundError,
  NoRecipientsError,
} from '../../src/domain/errors';
import { CampaignService } from '../../src/application/services/campaign.service';
import { FakeWhatsappBroadcast, InMemoryCampaignRepository } from '../support/fakes';

describe('CampaignService', () => {
  let repo: InMemoryCampaignRepository;
  let whatsapp: FakeWhatsappBroadcast;
  let service: CampaignService;

  beforeEach(() => {
    repo = new InMemoryCampaignRepository();
    whatsapp = new FakeWhatsappBroadcast();
    service = new CampaignService(repo, whatsapp);
  });

  const recipients = [
    { phone: '+6281', name: 'Andi' },
    { phone: '+6282', name: 'Budi' },
  ];

  describe('create', () => {
    it('dedupes recipients by phone (last wins) and sets totalRecipients', async () => {
      const c = await service.create('staff-1', 'Blast', 'Hi {{name}}', [
        { phone: '+6281', name: 'First' },
        { phone: '+6281', name: 'Second' },
        { phone: '+6282', name: 'Budi' },
      ]);
      expect(c.totalRecipients).toBe(2);
      expect(c.recipients).toHaveLength(2);
      expect(c.recipients.find((r) => r.phone === '+6281')?.name).toBe('Second');
      expect(c.status).toBe(CampaignStatus.DRAFT);
      expect(c.recipients.every((r) => r.status === RecipientStatus.PENDING)).toBe(true);
    });

    it('throws NoRecipientsError when the list is empty', async () => {
      await expect(service.create('staff-1', 'Blast', 'Hi', [])).rejects.toBeInstanceOf(
        NoRecipientsError,
      );
    });
  });

  describe('send', () => {
    it('dispatches to every recipient and tallies sent/failed counts', async () => {
      const created = await service.create('staff-1', 'Blast', 'Hi {{name}}', recipients);
      whatsapp.failOn('+6282');

      const sent = await service.send(created.id);
      expect(sent.status).toBe(CampaignStatus.SENT);
      expect(sent.sentCount).toBe(1);
      expect(sent.failedCount).toBe(1);
      expect(sent.sentAt).not.toBeNull();
      expect(whatsapp.sent).toHaveLength(2);
    });

    it('marks each recipient SENT or FAILED with the failure detail', async () => {
      const created = await service.create('staff-1', 'Blast', 'Hi {{name}}', recipients);
      whatsapp.failOn('+6282');

      const sent = await service.send(created.id);
      const ok = sent.recipients.find((r) => r.phone === '+6281');
      const bad = sent.recipients.find((r) => r.phone === '+6282');
      expect(ok?.status).toBe(RecipientStatus.SENT);
      expect(ok?.sentAt).not.toBeNull();
      expect(ok?.error).toBeNull();
      expect(bad?.status).toBe(RecipientStatus.FAILED);
      expect(bad?.error).toBe('simulated failure');
      expect(bad?.sentAt).toBeNull();
    });

    it('renders the template per recipient before sending', async () => {
      const created = await service.create('staff-1', 'Blast', 'Hi {{name}} ({{phone}})', [
        { phone: '+6281', name: 'Andi' },
      ]);
      await service.send(created.id);
      expect(whatsapp.sent[0].message).toBe('Hi Andi (+6281)');
    });

    it('throws CampaignNotDraftError when re-sending an already-SENT campaign', async () => {
      const created = await service.create('staff-1', 'Blast', 'Hi', recipients);
      await service.send(created.id);
      await expect(service.send(created.id)).rejects.toBeInstanceOf(CampaignNotDraftError);
    });

    it('throws CampaignNotFoundError for an unknown id', async () => {
      await expect(service.send(randomUUID())).rejects.toBeInstanceOf(CampaignNotFoundError);
    });
  });

  describe('get', () => {
    it('returns the campaign with recipients', async () => {
      const created = await service.create('staff-1', 'Blast', 'Hi', recipients);
      const got = await service.get(created.id);
      expect(got.id).toBe(created.id);
      expect(got.recipients).toHaveLength(2);
    });

    it('throws CampaignNotFoundError when missing', async () => {
      await expect(service.get(randomUUID())).rejects.toBeInstanceOf(CampaignNotFoundError);
    });
  });
});
