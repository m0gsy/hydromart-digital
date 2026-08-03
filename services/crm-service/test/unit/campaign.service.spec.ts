import { randomUUID } from 'node:crypto';

import { CampaignStatus } from '../../src/domain/campaign-status';
import { RecipientStatus } from '../../src/domain/recipient-status';
import {
  CampaignNotDraftError,
  CampaignNotFoundError,
  NoRecipientsError,
  SegmentUnavailableError,
} from '../../src/domain/errors';
import { CampaignService } from '../../src/application/services/campaign.service';
import {
  FakeCustomerDirectory,
  FakeWhatsappBroadcast,
  InMemoryCampaignRepository,
} from '../support/fakes';

describe('CampaignService', () => {
  let repo: InMemoryCampaignRepository;
  let whatsapp: FakeWhatsappBroadcast;
  let directory: FakeCustomerDirectory;
  let service: CampaignService;

  beforeEach(() => {
    repo = new InMemoryCampaignRepository();
    whatsapp = new FakeWhatsappBroadcast();
    directory = new FakeCustomerDirectory();
    service = new CampaignService(repo, whatsapp, directory);
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

    it('resolves recipients from a segment (FR-087), forwarding the caller token', async () => {
      directory.recipients = [
        { customerId: 'c1', name: 'Sinta', phone: '+628111', tier: 'SILVER', city: 'Depok' },
        { customerId: 'c2', name: 'Bima', phone: '+628222', tier: 'BASIC', city: 'Bogor' },
      ];
      const c = await service.create('staff-1', 'Blast', 'Hi {{name}}', undefined, {
        tier: 'SILVER',
      }, 'Bearer tok');
      expect(c.totalRecipients).toBe(1);
      expect(c.recipients[0]).toMatchObject({ phone: '+628111', name: 'Sinta', customerId: 'c1' });
      expect(directory.lastAuth).toBe('Bearer tok');
    });

    it('resolves an EMPTY segment to all reachable customers (design 10d "Semua pelanggan")', async () => {
      directory.recipients = [
        { customerId: 'c1', name: 'Sinta', phone: '+628111', tier: 'SILVER', city: 'Depok' },
        { customerId: 'c2', name: 'Bima', phone: '+628222', tier: 'BASIC', city: 'Bogor' },
      ];
      const c = await service.create('staff-1', 'Blast', 'Hi {{name}}', undefined, {}, 'Bearer tok');
      expect(c.totalRecipients).toBe(2);
      expect(directory.lastAuth).toBe('Bearer tok');
    });

    it('fails closed with SegmentUnavailableError when the directory is down', async () => {
      directory.down = true;
      await expect(
        service.create('staff-1', 'Blast', 'Hi', undefined, { city: 'Depok' }, 'Bearer tok'),
      ).rejects.toBeInstanceOf(SegmentUnavailableError);
    });

    it('throws NoRecipientsError when a segment resolves to nobody', async () => {
      directory.recipients = [];
      await expect(
        service.create('staff-1', 'Blast', 'Hi', undefined, { tier: 'GOLD' }, 'Bearer tok'),
      ).rejects.toBeInstanceOf(NoRecipientsError);
    });
  });

  // B-17: send() CLAIMS, the sweep DELIVERS. Sending inside the request timed out at the
  // proxy on any real list, and a recycled container stranded the campaign in SENDING
  // with half its customers messaged and no record of which half.
  describe('send (claim only)', () => {
    it('returns immediately without messaging anybody', async () => {
      const created = await service.create('staff-1', 'Blast', 'Hi {{name}}', recipients);

      const queued = await service.send(created.id);
      expect(queued.status).toBe(CampaignStatus.SENDING);
      expect(whatsapp.sent).toHaveLength(0);
      expect(queued.recipients.every((r) => r.status === RecipientStatus.PENDING)).toBe(true);
    });

    it('throws CampaignNotDraftError when re-sending an already-claimed campaign', async () => {
      const created = await service.create('staff-1', 'Blast', 'Hi', recipients);
      await service.send(created.id);
      await expect(service.send(created.id)).rejects.toBeInstanceOf(CampaignNotDraftError);
    });

    /**
     * The race the audit named. Both callers read a DRAFT campaign and both pass
     * canSend(); only the conditional update tells them apart. Without it both would
     * claim, and the sweep would have no way to know it had been told to send twice.
     */
    it('two simultaneous sends: exactly one claims, the other is rejected', async () => {
      const created = await service.create('staff-1', 'Blast', 'Hi', recipients);

      const results = await Promise.allSettled([
        service.send(created.id),
        service.send(created.id),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(rejected.reason).toBeInstanceOf(CampaignNotDraftError);
    });

    it('throws CampaignNotFoundError for an unknown id', async () => {
      await expect(service.send(randomUUID())).rejects.toBeInstanceOf(CampaignNotFoundError);
    });
  });

  describe('processSending (the broadcast sweep)', () => {
    it('delivers to every recipient and finalises with counts from the rows', async () => {
      const created = await service.create('staff-1', 'Blast', 'Hi {{name}}', recipients);
      whatsapp.failOn('+6282');
      await service.send(created.id);

      const result = await service.processSending();
      expect(result).toEqual({ campaigns: 1, sent: 1, failed: 1, completed: 1 });

      const done = await service.get(created.id);
      expect(done.status).toBe(CampaignStatus.SENT);
      expect(done.sentCount).toBe(1);
      expect(done.failedCount).toBe(1);
      expect(done.sentAt).not.toBeNull();
      expect(whatsapp.sent).toHaveLength(2);
    });

    it('marks each recipient SENT or FAILED with the failure detail', async () => {
      const created = await service.create('staff-1', 'Blast', 'Hi {{name}}', recipients);
      whatsapp.failOn('+6282');
      await service.send(created.id);
      await service.processSending();

      const done = await service.get(created.id);
      const ok = done.recipients.find((r) => r.phone === '+6281');
      const bad = done.recipients.find((r) => r.phone === '+6282');
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
      await service.processSending();
      expect(whatsapp.sent[0].message).toBe('Hi Andi (+6281)');
    });

    it('does nothing for a DRAFT campaign nobody has queued', async () => {
      await service.create('staff-1', 'Blast', 'Hi', recipients);
      expect(await service.processSending()).toEqual({
        campaigns: 0,
        sent: 0,
        failed: 0,
        completed: 0,
      });
      expect(whatsapp.sent).toHaveLength(0);
    });

    /**
     * A finished campaign leaves SENDING, so the next tick must not pick it up and message
     * everyone a second time — the exact failure the old in-request loop produced when a
     * timed-out caller retried.
     */
    it('a second tick after completion sends nothing more', async () => {
      const created = await service.create('staff-1', 'Blast', 'Hi', recipients);
      await service.send(created.id);
      await service.processSending();

      expect(await service.processSending()).toEqual({
        campaigns: 0,
        sent: 0,
        failed: 0,
        completed: 0,
      });
      expect(whatsapp.sent).toHaveLength(2);
    });

    /**
     * Two overlapping ticks (a slow sweep and the next cron fire) must not both send to
     * the same recipient. The claim is what prevents it: the second call finds nothing
     * PENDING left to move.
     */
    it('overlapping ticks each message a recipient at most once', async () => {
      const created = await service.create('staff-1', 'Blast', 'Hi', recipients);
      await service.send(created.id);

      await Promise.all([service.processSending(), service.processSending()]);
      expect(whatsapp.sent).toHaveLength(2);
      expect(new Set(whatsapp.sent.map((s) => s.phone)).size).toBe(2);
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
