import { InboxBroadcastDelivery } from '../../src/infrastructure/notification/inbox-broadcast.delivery';
import { NotificationService } from '../../src/application/services/notification.service';
import { NotificationEvent } from '../../src/domain/notification-event';

/**
 * F1b · the marketing opt-out, at the one place every campaign message passes.
 *
 * The durable gate is the audience query in customer-service — no network hop, no failure
 * mode, and the campaign's recipient count stays honest. This is the backstop for the door
 * that query cannot cover: `CampaignService.create` accepts an EXPLICIT recipient list
 * (a pasted list of numbers) that never touches the directory at all.
 *
 * Refusing by throwing rather than returning quietly is deliberate: the sweep records the
 * recipient FAILED with the thrown message, which is exactly what staff need to see next to
 * a pasted number. It follows the pattern already above it in the sweep, where a number
 * with no Hydromart account is recorded FAILED with "nothing to deliver to".
 */
describe('InboxBroadcastDelivery · marketing opt-out', () => {
  const notify = jest.fn();
  const notifications = { notify } as unknown as NotificationService;

  const withPrefs = (marketingAllowed: jest.Mock) =>
    new InboxBroadcastDelivery(notifications, { marketingAllowed } as never);

  beforeEach(() => {
    notify.mockReset().mockResolvedValue(undefined);
  });

  it('delivers to a customer who never switched it off', async () => {
    const delivery = withPrefs(jest.fn().mockResolvedValue(true));
    await delivery.deliver('+62800', 'Promo galon', 'cust-1');
    expect(notify).toHaveBeenCalledWith(NotificationEvent.BROADCAST, '+62800', { message: 'Promo galon' }, 'cust-1');
  });

  it('refuses a customer who switched it off, and says why', async () => {
    const delivery = withPrefs(jest.fn().mockResolvedValue(false));
    await expect(delivery.deliver('+62800', 'Promo galon', 'cust-1')).rejects.toThrow(/promo/i);
    expect(notify).not.toHaveBeenCalled();
  });

  it('writes no inbox row for a refusal either — the opt-out covers the record, not just the push', async () => {
    const delivery = withPrefs(jest.fn().mockResolvedValue(false));
    await delivery.deliver('+62800', 'Promo', 'cust-1').catch(() => undefined);
    expect(notify).not.toHaveBeenCalled();
  });

  it('delivers when the preference cannot be read — an outage must not kill a campaign', async () => {
    const delivery = withPrefs(jest.fn().mockRejectedValue(new Error('customer-service down')));
    await delivery.deliver('+62800', 'Promo', 'cust-1');
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('delivers when no preference port is wired at all', async () => {
    const delivery = new InboxBroadcastDelivery(notifications);
    await delivery.deliver('+62800', 'Promo', 'cust-1');
    expect(notify).toHaveBeenCalledTimes(1);
  });
});
