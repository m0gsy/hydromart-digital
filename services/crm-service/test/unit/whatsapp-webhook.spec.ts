import { ModuleRef } from '@nestjs/core';

import { WhatsappConsentService } from '../../src/application/services/whatsapp-consent.service';
import { WhatsappWebhookService } from '../../src/application/services/whatsapp-webhook.service';
import { WhatsappService } from '../../src/application/services/whatsapp.service';
import { WA_REPLY_CODE_INVALID, WA_REPLY_OTHER, WA_REPLY_PROMO, WA_REPLY_STARTED, WA_REPLY_STOPPED } from '../../src/domain/wa-replies';
import { FakeCaps, FakeConsent, FakeMessages, FakeSender, FakeActivity, FakeDirectory, FakeTemplates, FakeTx, waConfig } from '../support/wa-fakes';

const PHONE = '6281234567890';
const CUSTOMER = 'cust-1';
let n = 0;
const text = (body: string, from = PHONE) => ({ id: `wamid.in${(n += 1)}`, from, type: 'text', text: { body } });
const payload = (value: Record<string, unknown>, field = 'messages', waba = '2222') => ({
  object: 'whatsapp_business_account',
  entry: [{ id: waba, changes: [{ field, value: { metadata: { phone_number_id: '1111' }, ...value } }] }],
});

describe('WhatsappWebhookService', () => {
  let consent: FakeConsent;
  let messages: FakeMessages;
  let caps: FakeCaps;
  let templates: FakeTemplates;
  let sender: FakeSender;
  let webhook: WhatsappWebhookService;

  beforeEach(() => {
    consent = new FakeConsent();
    messages = new FakeMessages();
    caps = new FakeCaps();
    templates = new FakeTemplates();
    sender = new FakeSender();
    caps.setCap('SERVICE', { monthlyMessages: 100 });
    caps.setCap('UTILITY', { monthlyMessages: 100 });
    const config = waConfig();
    const tx = new FakeTx(consent, messages, caps);
    const consentService = new WhatsappConsentService(config, consent, tx, new FakeActivity(), new FakeDirectory());
    const whatsapp = new WhatsappService(config, consent, messages, caps, templates, sender, consentService, { get: () => ({ notify: jest.fn() }) } as unknown as ModuleRef);
    webhook = new WhatsappWebhookService(config, consentService, whatsapp, tx, templates);
  });

  const state = (purpose: string) => {
    const mine = consent.rows.filter((r) => r.purpose === purpose && r.phone === PHONE);
    return mine.length ? mine[mine.length - 1].granted : null;
  };
  const code = async (kind: 'SELF' | 'CASHIER' = 'SELF', ttlMs = 60_000) =>
    (await consent.createCode({ code: 'AB23CD45', kind, customerId: kind === 'SELF' ? CUSTOMER : null, depotId: kind === 'CASHIER' ? 'dep-1' : null, createdBy: 'u1', expiresAt: new Date(Date.now() + ttlMs) }));
  const lastReply = () => sender.texts[sender.texts.length - 1]?.body;

  it('DAFTAR <code> links the number to the customer, records consent once, and answers with the consent text', async () => {
    const c = await code();
    await webhook.handle(payload({ messages: [text('daftar ab23cd45')] }));
    expect(consent.rows).toHaveLength(1);
    expect(consent.rows[0]).toMatchObject({ phone: PHONE, customerId: CUSTOMER, waNumber: '1', purpose: 'UTILITY', granted: true, source: 'APP', sourceRef: c.id, legalEntity: 'PT Contoh' });
    expect(lastReply()).toContain('PT Contoh');
    expect(lastReply()).toContain('Balas PROMO');
  });

  it('a cashier code records CASHIER_QR with the depot, for a walk-in with no customer', async () => {
    await code('CASHIER');
    await webhook.handle(payload({ messages: [text('DAFTAR AB23CD45')] }));
    expect(consent.rows[0]).toMatchObject({ source: 'CASHIER_QR', customerId: null, depotId: 'dep-1' });
  });

  it('an expired, used or unknown code writes no consent and says so', async () => {
    await code('SELF', -1000);
    await webhook.handle(payload({ messages: [text('DAFTAR AB23CD45'), text('DAFTAR ZZZZZZZZ')] }));
    expect(consent.rows).toEqual([]);
    expect(sender.texts.map((t) => t.body)).toEqual([WA_REPLY_CODE_INVALID, WA_REPLY_CODE_INVALID]);
  });

  it('two numbers using one code at once: exactly one wins', async () => {
    await code();
    await Promise.all([
      webhook.handle(payload({ messages: [text('DAFTAR AB23CD45', PHONE)] })),
      webhook.handle(payload({ messages: [text('DAFTAR AB23CD45', '6281999999999')] })),
    ]);
    expect(consent.rows).toHaveLength(1);
  });

  it('the same wamid delivered twice is processed once', async () => {
    await code();
    const message = text('DAFTAR AB23CD45');
    await webhook.handle(payload({ messages: [message] }));
    await webhook.handle(payload({ messages: [message] }));
    expect(consent.rows).toHaveLength(1);
    expect(sender.texts).toHaveLength(1);
  });

  it('a throw while processing rolls the dedupe key back, so the retry processes the item', async () => {
    await code();
    const message = text('DAFTAR AB23CD45');
    const append = jest.spyOn(consent, 'append').mockRejectedValueOnce(new Error('db'));
    await expect(webhook.handle(payload({ messages: [message] }))).rejects.toThrow('db');
    expect(messages.inbound.size).toBe(0);
    append.mockRestore();
    // the code was claimed inside the failed transaction; the real database rolls that back too
    consent.codes[0].usedAt = null;
    await webhook.handle(payload({ messages: [message] }));
    expect(consent.rows).toHaveLength(1);
  });

  describe('keywords', () => {
    beforeEach(async () => {
      await code();
      await webhook.handle(payload({ messages: [text('DAFTAR AB23CD45')] }));
    });

    it('STOP revokes utility and marketing for each customer the number was linked to, cancels what is queued and gives the slots back', async () => {
      await messages.insertIfNew({ notificationId: null, dedupeKey: 'q1', customerId: CUSTOMER, phone: PHONE, waNumber: '1', category: 'UTILITY', templateName: 't', language: 'id', vars: {}, status: 'QUEUED', skipReason: null, monthKey: '2026-11' });
      await webhook.handle(payload({ messages: [text(' stop. ')] }));
      expect(state('UTILITY')).toBe(false);
      expect(state('MARKETING')).toBe(false);
      expect(consent.rows.filter((r) => !r.granted).every((r) => r.customerId === CUSTOMER && r.source === 'KEYWORD')).toBe(true);
      expect(messages.rows.find((r) => r.dedupeKey === 'q1')?.status).toBe('CANCELLED');
      expect(caps.releases).toEqual(['2026-11|UTILITY']);
      expect(lastReply()).toBe(WA_REPLY_STOPPED);
    });

    it('STOP from a number we never heard of still writes the do-not-contact rows', async () => {
      await webhook.handle(payload({ messages: [text('BERHENTI', '6281777777777')] }));
      const rows = consent.rows.filter((r) => r.phone === '6281777777777');
      expect(rows.map((r) => `${r.purpose}:${r.granted}:${r.customerId}`).sort()).toEqual(['MARKETING:false:null', 'UTILITY:false:null']);
    });

    it('MULAI turns utility back on only for a number that opted in before', async () => {
      await webhook.handle(payload({ messages: [text('STOP'), text('MULAI')] }));
      expect(state('UTILITY')).toBe(true);
      expect(lastReply()).toBe(WA_REPLY_STARTED);
      await webhook.handle(payload({ messages: [text('MULAI', '6281888888888')] }));
      expect(consent.rows.some((r) => r.phone === '6281888888888')).toBe(false);
      expect(lastReply()).toBe(WA_REPLY_OTHER);
    });

    it('PROMO needs utility first, then grants marketing; without it it is an ordinary message', async () => {
      await webhook.handle(payload({ messages: [text('PROMO')] }));
      expect(state('MARKETING')).toBe(true);
      expect(lastReply()).toBe(WA_REPLY_PROMO);
      await webhook.handle(payload({ messages: [text('PROMO', '6281888888888')] }));
      expect(consent.rows.some((r) => r.phone === '6281888888888')).toBe(false);
    });

    it('anything else gets one automatic reply per phone per day, not one per message', async () => {
      // The registration reply just went out, so this number is inside its day; another number is answered once.
      const other = '6281666666666';
      await webhook.handle(payload({ messages: [text('halo', PHONE)] }));
      expect(sender.texts.filter((t) => t.body === WA_REPLY_OTHER)).toHaveLength(0);
      await webhook.handle(payload({ messages: [text('halo kak', other), text('stop saya', other), { id: 'wamid.img', from: other, type: 'image' }] }));
      expect(sender.texts.filter((t) => t.body === WA_REPLY_OTHER)).toHaveLength(1);
      expect(state('UTILITY')).toBe(true);
    });
  });

  describe('delivery reports', () => {
    const sent = async (id = 'wamid.out1') => {
      await messages.insertIfNew({ notificationId: null, dedupeKey: `k${id}`, customerId: CUSTOMER, phone: PHONE, waNumber: '1', category: 'UTILITY', templateName: 't', language: 'id', vars: {}, status: 'QUEUED', skipReason: null, monthKey: '2026-11' });
      await messages.markSent(messages.rows[messages.rows.length - 1].id, id, new Date());
    };
    const status = (id: string, s: string, extra: Record<string, unknown> = {}) => payload({ statuses: [{ id, status: s, timestamp: '1795000000', ...extra }] });

    it('moves forward only: READ then SENT leaves READ', async () => {
      await sent();
      await webhook.handle(status('wamid.out1', 'delivered'));
      await webhook.handle(status('wamid.out1', 'read'));
      await webhook.handle(status('wamid.out1', 'sent'));
      expect(messages.rows[0].status).toBe('READ');
    });

    it('a status carrying errors fails the message and gives the slot back once', async () => {
      await sent();
      await webhook.handle(status('wamid.out1', 'failed', { errors: [{ code: 131026, title: 'Undeliverable' }] }));
      await webhook.handle(status('wamid.out1', 'failed', { errors: [{ code: 131026, title: 'Undeliverable' }] }));
      expect(messages.rows[0].status).toBe('FAILED');
      expect(caps.releases).toHaveLength(1);
    });

    it('billable false gives the reservation back once, however many reports say so', async () => {
      await sent();
      await webhook.handle(status('wamid.out1', 'sent', { pricing: { billable: false } }));
      await webhook.handle(status('wamid.out1', 'delivered', { pricing: { billable: false } }));
      expect(caps.releases).toHaveLength(1);
    });

    it('a failed report with no error list, or an error with no code, still fails the message with a reason', async () => {
      await sent();
      await webhook.handle(status('wamid.out1', 'failed', { timestamp: undefined }));
      expect(messages.rows[0]).toMatchObject({ status: 'FAILED' });
      await sent('wamid.out2');
      await webhook.handle(status('wamid.out2', 'delivered', { errors: [{ title: 'No code' }] }));
      expect(messages.rows[1].status).toBe('FAILED');
    });

    it('a report that beat our own markSent is not lost: the item rolls back and the retry applies it', async () => {
      await sent('wamid.late');
      const row = messages.rows[0];
      const meta = row.metaMessageId;
      row.metaMessageId = null; // markSent has not stored the wamid yet
      await expect(webhook.handle(status('wamid.late', 'delivered'))).rejects.toThrow();
      expect(messages.inbound.has('wamid.late:delivered')).toBe(false);
      row.metaMessageId = meta;
      await webhook.handle(status('wamid.late', 'delivered'));
      expect(row.status).toBe('DELIVERED');
    });

    it('a repeat, or an unknown state, changes nothing', async () => {
      await webhook.handle(status('wamid.out1', 'weird'));
      await webhook.handle(payload({ statuses: [{ status: 'sent' }] }));
      expect(caps.releases).toEqual([]);
    });
  });

  it('applies a template status update, and ignores one that is incomplete or unknown', async () => {
    await templates.ensure({ name: 'hm_order_confirmed', language: 'id', event: 'ORDER_CONFIRMED', category: 'UTILITY', bodyParams: 2 });
    const update = (value: Record<string, unknown>) => payload(value, 'message_template_status_update');
    await webhook.handle(update({ event: 'APPROVED', message_template_name: 'hm_order_confirmed', message_template_language: 'id' }));
    expect(templates.rows[0].status).toBe('APPROVED');
    await webhook.handle(update({ event: 'REJECTED', message_template_name: 'hm_order_confirmed', message_template_language: 'id', reason: 'INVALID_FORMAT' }));
    expect(templates.rows[0]).toMatchObject({ status: 'REJECTED', statusReason: 'INVALID_FORMAT' });
    await webhook.handle(update({ event: 'WHATEVER', message_template_name: 'hm_order_confirmed', message_template_language: 'id' }));
    await webhook.handle(update({ event: 'APPROVED' }));
    expect(templates.rows[0].status).toBe('REJECTED');
  });

  it('ignores another WABA, another number, an unknown field and garbage, without throwing', async () => {
    await code();
    await webhook.handle(payload({ messages: [text('DAFTAR AB23CD45')] }, 'messages', 'other-waba'));
    await webhook.handle({ entry: [{ id: '2222', changes: [{ field: 'messages', value: { metadata: { phone_number_id: 'other' }, messages: [text('DAFTAR AB23CD45')] } }] }] });
    await webhook.handle(payload({}, 'account_update'));
    await webhook.handle(payload({ messages: [{ id: 'x' }, { from: PHONE }, text('hi', 'not-a-number')] }));
    await webhook.handle(null);
    await webhook.handle({ entry: 'nope' });
    expect(consent.rows).toEqual([]);
    expect(sender.texts).toEqual([]);
  });
});
