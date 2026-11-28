import { ModuleRef } from '@nestjs/core';

import { localMonthKey } from '@hydromart/platform';

import { WhatsappConsentService } from '../../src/application/services/whatsapp-consent.service';
import { WhatsappService } from '../../src/application/services/whatsapp.service';
import { WA_CONSENT_TEXT_VERSION } from '../../src/domain/wa-consent';
import { NotificationEvent } from '../../src/domain/notification-event';
import { FakeCaps, FakeConsent, FakeMessages, FakeSender, FakeActivity, FakeDirectory, FakeTemplates, FakeTx, WA_ENV, waConfig } from '../support/wa-fakes';

const PHONE = '6281234567890';
const CUSTOMER = 'cust-1';
const MONTH = localMonthKey(new Date());
const EVENT = NotificationEvent.ORDER_CONFIRMED;
const input = (over: Record<string, unknown> = {}) => ({
  event: EVENT,
  customerId: CUSTOMER,
  notificationId: 'n-1',
  dedupeKey: 'order-1',
  vars: { name: 'Budi', orderNumber: 'HM-1' },
  ...over,
});

describe('WhatsappService (send path)', () => {
  let consent: FakeConsent;
  let messages: FakeMessages;
  let caps: FakeCaps;
  let templates: FakeTemplates;
  let sender: FakeSender;
  let notify: jest.Mock;
  let service: WhatsappService;
  let consentService: WhatsappConsentService;

  const build = (env: Record<string, string> = WA_ENV) => {
    notify = jest.fn().mockResolvedValue(undefined);
    const moduleRef = { get: () => ({ notify }) } as unknown as ModuleRef;
    const config = waConfig(env);
    consentService = new WhatsappConsentService(config, consent, new FakeTx(consent, messages, caps), new FakeActivity(), new FakeDirectory());
    service = new WhatsappService(config, consent, messages, caps, templates, sender, consentService, moduleRef);
  };
  const optIn = () =>
    consent.append({
      phone: PHONE,
      customerId: CUSTOMER,
      waNumber: '1',
      purpose: 'UTILITY',
      legalEntity: 'PT',
      granted: true,
      textVersion: WA_CONSENT_TEXT_VERSION,
      source: 'APP',
      sourceRef: `r${consent.rows.length}`,
      depotId: null,
    });
  const approve = () => templates.ensure({ name: 'hm_order_confirmed', language: 'id', event: EVENT, category: 'UTILITY', bodyParams: 2 }).then(() => templates.setStatus('hm_order_confirmed', 'id', 'APPROVED', null));

  beforeEach(async () => {
    consent = new FakeConsent();
    messages = new FakeMessages();
    caps = new FakeCaps();
    templates = new FakeTemplates();
    sender = new FakeSender();
    caps.setCap('UTILITY', { monthlyMessages: 10 });
    build();
    await optIn();
    await approve();
  });

  const only = () => messages.rows[messages.rows.length - 1];

  it('sends the approved template to the opted-in customer and records the wamid', async () => {
    await service.enqueue(input());
    expect(sender.templates).toEqual([{ to: PHONE, name: 'hm_order_confirmed', language: 'id', params: ['Budi', 'HM-1'] }]);
    expect(only()).toMatchObject({ status: 'SENT', metaMessageId: 'wamid.1', dedupeKey: 'wa:order-1', category: 'UTILITY', vars: { name: 'Budi', orderNumber: 'HM-1' } });
    expect(caps.counters.get(`1|${MONTH}|UTILITY`)?.messages).toBe(1);
  });

  it('writes nothing and calls nobody while WA_ENABLED is blank, and for an event that is not a utility one', async () => {
    build({ ...WA_ENV, WA_ENABLED: '' });
    await service.enqueue(input());
    build();
    await service.enqueue(input({ event: NotificationEvent.STOCK_LOW }));
    expect(messages.rows).toEqual([]);
    expect(sender.templates).toEqual([]);
  });

  // The table: every refusal keeps a row with its reason, and nothing leaves.
  const refusals: Array<[string, () => Promise<void> | void, () => void]> = [
    ['OFF (enabled but a key missing)', () => build({ ...WA_ENV, WA_VERIFY_TOKEN: '' }), () => undefined],
    ['CAP (no cap row)', () => void caps.caps.clear(), () => undefined],
    ['PAUSED', () => void (caps.caps.get('1|UTILITY')!.paused = true), () => undefined],
    ['STOPPED', () => consent.append({ phone: PHONE, customerId: CUSTOMER, waNumber: '1', purpose: 'UTILITY', legalEntity: 'PT', granted: false, textVersion: 'v', source: 'KEYWORD', sourceRef: 'stop', depotId: null }).then(() => undefined), () => undefined],
    ['TEMPLATE_NOT_APPROVED', () => void templates.setStatus('hm_order_confirmed', 'id', 'SUBMITTED', null), () => undefined],
    ['MISSING_PARAM (no order number)', () => undefined, () => undefined],
  ];
  it.each(refusals)('%s leaves a SKIPPED row with the reason and sends nothing', async (label, arrange) => {
    await arrange();
    await service.enqueue(input(label.startsWith('MISSING') ? { vars: { name: 'Budi' } } : {}));
    expect(only()).toMatchObject({ status: 'SKIPPED', skipReason: label.split(' ')[0] });
    expect(sender.templates).toEqual([]);
    expect(caps.counters.size).toBe(0);
  });

  it('a consent row with a blank number is SKIPPED NO_PHONE: there is nobody to message', async () => {
    consent.rows.length = 0;
    await consent.append({ phone: '', customerId: CUSTOMER, waNumber: '1', purpose: 'UTILITY', legalEntity: 'PT', granted: true, textVersion: 'v', source: 'APP', sourceRef: 'blank', depotId: null });
    await service.enqueue(input());
    expect(only()).toMatchObject({ status: 'SKIPPED', skipReason: 'NO_PHONE' });
  });

  it('a customer who never opted in leaves no row at all', async () => {
    consent.rows.length = 0;
    await service.enqueue(input());
    expect(messages.rows).toEqual([]);
    expect(sender.templates).toEqual([]);
  });

  it('falls back to "Pelanggan" for an empty name instead of sending an empty parameter', async () => {
    await service.enqueue(input({ vars: { name: '  ', orderNumber: 'HM-1' } }));
    expect(sender.templates[0].params).toEqual(['Pelanggan', 'HM-1']);
  });

  it('a retried event is one message: the dedupe key stops the second', async () => {
    await service.enqueue(input());
    await service.enqueue(input());
    expect(messages.rows).toHaveLength(1);
    expect(sender.templates).toHaveLength(1);
    expect(caps.counters.get(`1|${MONTH}|UTILITY`)?.messages).toBe(1);
  });

  it('keys the message on the notification id when the event has no key', async () => {
    await service.enqueue(input({ dedupeKey: null }));
    expect(only().dedupeKey).toBe('wa:n-1');
  });

  it('cap 3: the fourth is SKIPPED CAP, and the 80 percent warning and the stop are each filed once', async () => {
    caps.setCap('UTILITY', { monthlyMessages: 3 });
    for (let i = 0; i < 4; i += 1) await service.enqueue(input({ notificationId: `n${i}`, dedupeKey: `k${i}` }));
    expect(messages.rows.map((r) => r.status)).toEqual(['SENT', 'SENT', 'SENT', 'SKIPPED']);
    expect(messages.rows[3].skipReason).toBe('CAP');
    const events = notify.mock.calls.map((c) => c[0]);
    expect(events.filter((e) => e === NotificationEvent.WA_CAP_WARNING)).toHaveLength(1);
    expect(events.filter((e) => e === NotificationEvent.WA_CAP_REACHED)).toHaveLength(1);
    expect(notify.mock.calls[0]).toEqual([NotificationEvent.WA_CAP_WARNING, '', { category: 'UTILITY', used: '3', cap: '3', pct: '100' }, null, null, `WA_CAP_WARNING:1:${MONTH}:UTILITY`]);
  });

  it('a failing alert never costs the message', async () => {
    caps.setCap('UTILITY', { monthlyMessages: 1 });
    notify.mockRejectedValue(new Error('down'));
    await service.enqueue(input());
    expect(only().status).toBe('SENT');
  });

  it('the cost cap counts only when a rate is set', async () => {
    caps.setCap('UTILITY', { monthlyMessages: 100, rateIdr: 500, monthlyCostIdr: 1000 });
    for (let i = 0; i < 3; i += 1) await service.enqueue(input({ notificationId: `n${i}`, dedupeKey: `k${i}` }));
    expect(messages.rows.map((r) => r.status)).toEqual(['SENT', 'SENT', 'SKIPPED']);
  });

  describe('delivery', () => {
    it('a STOP landing between the checks and the HTTP call cancels the message, gives the slot back, and Meta is never called', async () => {
      sender.beforeSend = undefined as never;
      const real = consent.listForPhone.bind(consent);
      let reads = 0;
      consent.listForPhone = async (phone: string) => {
        reads += 1;
        if (reads === 1) {
          // the STOP is recorded after enqueue's own checks, before the final re-read
          await consent.append({ phone, customerId: CUSTOMER, waNumber: '1', purpose: 'UTILITY', legalEntity: 'PT', granted: false, textVersion: 'v', source: 'KEYWORD', sourceRef: 'stop', depotId: null });
        }
        return real(phone);
      };
      await service.enqueue(input());
      expect(only().status).toBe('CANCELLED');
      expect(sender.templates).toEqual([]);
      expect(caps.releases).toEqual([`${MONTH}|UTILITY`]);
    });

    it('a message Meta already accepted stays SENT when a STOP arrives; the next one is blocked', async () => {
      await service.enqueue(input());
      await consent.append({ phone: PHONE, customerId: CUSTOMER, waNumber: '1', purpose: 'UTILITY', legalEntity: 'PT', granted: false, textVersion: 'v', source: 'KEYWORD', sourceRef: 'stop', depotId: null });
      expect(await messages.cancelQueuedForPhone(PHONE)).toEqual([]);
      await service.enqueue(input({ notificationId: 'n2', dedupeKey: 'k2' }));
      expect(messages.rows.map((r) => `${r.status}${r.skipReason ?? ''}`)).toEqual(['SENT', 'SKIPPEDSTOPPED']);
    });

    it('a permanent refusal from Meta fails the row and gives the slot back', async () => {
      sender.next = { ok: false, permanent: true, code: '131026', error: 'HTTP 400 code 131026' };
      await service.enqueue(input());
      expect(only()).toMatchObject({ status: 'FAILED', errorCode: '131026' });
      expect(caps.releases).toHaveLength(1);
    });

    it('a passing failure stays QUEUED for the sweep, which retries and finally gives up after three tries', async () => {
      sender.next = { ok: false, permanent: false, code: null, error: 'timeout' };
      await service.enqueue(input());
      expect(only()).toMatchObject({ status: 'QUEUED', attempts: 1 });
      expect(await service.processQueue()).toMatchObject({ claimed: 1, retry: 1 });
      expect(await service.processQueue()).toMatchObject({ claimed: 1, failed: 1 });
      expect(only().status).toBe('FAILED');
      expect(caps.releases).toHaveLength(1);
      expect(await service.processQueue()).toMatchObject({ claimed: 0 });
    });

    it('a message older than the 15 minute window is given up at its next failure', async () => {
      sender.next = { ok: false, permanent: false, code: null, error: 'timeout' };
      await service.enqueue(input());
      only().createdAt = new Date(Date.now() - 16 * 60_000);
      await service.processQueue();
      expect(only().status).toBe('FAILED');
    });

    it('the sweep sends what Meta took on a later try, and survives a row that throws', async () => {
      sender.next = { ok: false, permanent: false, code: null, error: 'x' };
      await service.enqueue(input());
      sender.next = null;
      expect(await service.processQueue()).toMatchObject({ claimed: 1, sent: 1 });
      expect(only().status).toBe('SENT');

      sender.next = { ok: false, permanent: false, code: null, error: 'x' };
      await service.enqueue(input({ notificationId: 'n2', dedupeKey: 'k2' }));
      jest.spyOn(sender, 'sendTemplate').mockRejectedValueOnce(new Error('boom'));
      expect(await service.processQueue()).toMatchObject({ claimed: 1, sent: 0 });
    });

    it('a row with an unknown template or an empty stored parameter fails closed', async () => {
      await service.enqueue(input());
      const sent = only();
      messages.rows.push({ ...sent, id: 'x1', dedupeKey: 'bad1', status: 'QUEUED', templateName: 'nope' });
      messages.rows.push({ ...sent, id: 'x2', dedupeKey: 'bad2', status: 'QUEUED', vars: { name: '' } });
      expect(await service.processQueue()).toMatchObject({ claimed: 2, failed: 2 });
      expect(messages.rows.filter((r) => r.errorCode === 'BAD_TEMPLATE')).toHaveLength(2);
    });
  });

  describe('free-text replies (service window)', () => {
    it('counts at rate 0, sends once, and a replay with the same key sends nothing', async () => {
      caps.setCap('SERVICE', { monthlyMessages: 100 });
      await service.sendService(PHONE, 'Halo', 'wamid.in1');
      await service.sendService(PHONE, 'Halo', 'wamid.in1');
      expect(sender.texts).toEqual([{ to: PHONE, body: 'Halo' }]);
      expect(only()).toMatchObject({ category: 'SERVICE', status: 'SENT', dedupeKey: 'wa:svc:wamid.in1' });
    });

    it('without a SERVICE cap row the reply is SKIPPED CAP (fail closed), and a refusal by Meta is FAILED and released', async () => {
      await service.sendService(PHONE, 'Halo', 'a');
      expect(only()).toMatchObject({ status: 'SKIPPED', skipReason: 'CAP' });
      caps.setCap('SERVICE', { monthlyMessages: 100 });
      sender.next = { ok: false, permanent: true, code: '131047', error: 'window' };
      await service.sendService(PHONE, 'Halo', 'b');
      expect(only().status).toBe('FAILED');
      expect(caps.releases).toHaveLength(1);
    });

    it('a reply whose row cannot be read back sends nothing', async () => {
      caps.setCap('SERVICE', { monthlyMessages: 100 });
      jest.spyOn(messages, 'findByDedupeKey').mockResolvedValue(null);
      await service.sendService(PHONE, 'Halo', 'gone');
      expect(sender.texts).toEqual([]);
    });

    it('a SERVICE cap that is used up refuses the reply with its reason', async () => {
      caps.setCap('SERVICE', { monthlyMessages: 0 });
      await service.sendService(PHONE, 'Halo', 'full');
      expect(only()).toMatchObject({ status: 'SKIPPED', skipReason: 'CAP' });
      expect(sender.texts).toEqual([]);
    });

    it('never throws: a broken repository only costs the reply', async () => {
      jest.spyOn(messages, 'insertIfNew').mockRejectedValue(new Error('db'));
      await expect(service.sendService(PHONE, 'Halo', 'c')).resolves.toBeUndefined();
    });
  });

  it('a changed login number ends the consent of the old number (utility and marketing), so nothing is redirected', async () => {
    await service.phoneChanged('+6281234567890');
    expect(consent.rows.filter((r) => !r.granted).map((r) => `${r.purpose}:${r.customerId}`).sort()).toEqual(['MARKETING:cust-1', 'UTILITY:cust-1']);
    await service.enqueue(input());
    expect(only()).toMatchObject({ status: 'SKIPPED', skipReason: 'STOPPED' });
    // a number that never agreed, or garbage, changes nothing and never throws
    await service.phoneChanged('0899999999999');
    await service.phoneChanged('abc');
    expect(consent.rows).toHaveLength(3);
    jest.spyOn(consentService, 'revokePhone').mockRejectedValue(new Error('db'));
    await expect(service.phoneChanged('6281234567890')).resolves.toBeUndefined();
  });

  it('enqueue never throws into the notification', async () => {
    jest.spyOn(caps, 'getCap').mockRejectedValue(new Error('db down'));
    await expect(service.enqueue(input())).resolves.toBeUndefined();
  });
});
