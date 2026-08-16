import { CampaignService } from '../../src/application/services/campaign.service';
import { NoRecipientsError } from '../../src/domain/errors';
import { RecipientStatus } from '../../src/domain/recipient-status';
import { BroadcastDeliveryPort } from '../../src/application/ports/broadcast-delivery.port';
import {
  FakeActivitySegment,
  FakeCustomerDirectory,
  FakeBroadcastDelivery,
  InMemoryCampaignRepository,
} from '../support/fakes';

// Branch gap-fills for CampaignService the main spec leaves out: list() + clampPage clamping,
// the default `recipients` parameter, a recipient with no name, and a delivery failure that
// returns no error string (the `?? 'unknown error'` fallback).

describe('CampaignService branches', () => {
  let repo: InMemoryCampaignRepository;
  let directory: FakeCustomerDirectory;

  beforeEach(() => {
    repo = new InMemoryCampaignRepository();
    directory = new FakeCustomerDirectory();
  });

  const service = (delivery: BroadcastDeliveryPort): CampaignService =>
    new CampaignService(repo, delivery, directory, new FakeActivitySegment());

  it('uses the default (empty) recipients list, throwing NoRecipientsError', async () => {
    await expect(service(new FakeBroadcastDelivery()).create('staff', 'Blast', 'Hi')).rejects.toBeInstanceOf(
      NoRecipientsError,
    );
  });

  /*
   * A broadcast is delivered by writing it to the recipient's inbox, so a recipient with no
   * Hydromart account has nowhere to receive it. Counting those as SENT would report a reach
   * the campaign never had — a staff-pasted list can be nothing but bare phone numbers.
   *
   * This replaced the E-2 test, which asserted that the sweep refused to run at all when
   * WHATSAPP_API_URL was blank. There is no external endpoint to be missing any more: the
   * inbox write is local, so the sweep always runs and failure is now per recipient.
   */
  it('records a recipient with no customer account FAILED, and still delivers the others', async () => {
    const delivery = new FakeBroadcastDelivery();
    const svc = service(delivery);
    const created = await svc.create('staff', 'Blast', 'Hi', [
      { phone: '+6281', customerId: 'cust-1' },
      { phone: '+6282' },
    ]);
    await svc.send(created.id);

    const result = await svc.processSending();

    expect(result.sent).toBe(1);
    expect(result.failed).toBe(1);
    expect(delivery.sent).toEqual([{ phone: '+6281', message: 'Hi', customerId: 'cust-1' }]);

    const detail = await svc.get(created.id);
    expect(detail.sentCount).toBe(1);
    expect(detail.failedCount).toBe(1);
  });

  it('records a recipient FAILED when delivery throws, without abandoning the batch', async () => {
    const delivery = new FakeBroadcastDelivery();
    delivery.failOn('+6281');
    const svc = service(delivery);
    const created = await svc.create('staff', 'Blast', 'Hi', [
      { phone: '+6281', customerId: 'cust-1' },
      { phone: '+6282', customerId: 'cust-2' },
    ]);
    await svc.send(created.id);

    const result = await svc.processSending();

    expect(result).toMatchObject({ sent: 1, failed: 1, completed: 1 });
    // Both were attempted — the batch was not abandoned at the first throw. Which one
    // actually landed is on the rows, not on the attempt log.
    expect(delivery.sent.map((s) => s.phone)).toEqual(['+6281', '+6282']);
    const rows = (await svc.get(created.id)).recipients;
    expect(rows.find((r) => r.phone === '+6281')?.error).toBe('simulated failure');
    expect(rows.find((r) => r.phone === '+6282')?.status).toBe(RecipientStatus.SENT);
  });

  it('list() clamps page and limit to the allowed range', async () => {
    const svc = service(new FakeBroadcastDelivery());
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
    // A throw with an empty message is the transport failing without saying why. The sweep
    // must still write a reason on the row — a FAILED recipient with a blank error is
    // indistinguishable from one nobody looked at.
    const delivery: BroadcastDeliveryPort = {
      deliver: async () => {
        throw new Error('');
      },
    };
    const svc = service(delivery);
    const created = await svc.create('staff', 'Blast', 'Hi {{name}}', [
      { phone: '+6281', customerId: 'cust-1' },
    ]);
    await svc.send(created.id);
    await svc.processSending();
    const recipient = (await svc.get(created.id)).recipients[0];
    expect(recipient.status).toBe(RecipientStatus.FAILED);
    expect(recipient.error).toBe('unknown error')
  });
});
