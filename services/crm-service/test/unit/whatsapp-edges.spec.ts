import { BadRequestException, ExecutionContext, ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';

import { WaOverview, WhatsappAdminService } from '../../src/application/services/whatsapp-admin.service';
import { WhatsappConsentService, maskWaPhone } from '../../src/application/services/whatsapp-consent.service';
import { WaTemplateRecord } from '../../src/application/ports/wa.repository';
import { WA_TEMPLATE_SPECS, WA_UTILITY_EVENTS } from '../../src/domain/wa-templates';
import { buildTemplateParams, waRegisteredReply, WA_REPLY_CODE_INVALID } from '../../src/domain/wa-replies';
import { verifyMetaSignature } from '../../src/domain/wa-signature';
import { MetaWhatsappSenderAdapter } from '../../src/infrastructure/whatsapp/meta-whatsapp.sender.adapter';
import { WhatsappInternalController } from '../../src/modules/whatsapp-internal.controller';
import { WhatsappSyncController } from '../../src/modules/whatsapp-sync.controller';
import { WhatsappWebhookController } from '../../src/modules/whatsapp-webhook.controller';
import { WhatsappController } from '../../src/modules/whatsapp.controller';
import { MetaSignatureGuard, WaReadyGuard } from '../../src/modules/whatsapp.guards';
import { FakeCaps, FakeConsent, FakeMessages, FakeTemplates, FakeTx, WA_ENV, waConfig } from '../support/wa-fakes';

// Fixed vectors: the secret, the exact bytes, and the header computed once with createHmac and pasted.
const SECRET = 's3cr3t-app-secret';
const BODY = '{"object":"whatsapp_business_account","entry":[]}';
const HEADER = 'sha256=38aa970a90aeae51140d83b3f1d276c8c568e8166ac8c483a633ee90eb554f12';

describe('Meta signature over the raw body', () => {
  const ok = (secret: string, body: string, header: string | undefined) => verifyMetaSignature(secret, Buffer.from(body), header);
  it('accepts exactly the signed bytes', () => {
    expect(ok(SECRET, BODY, HEADER)).toBe(true);
  });
  it.each([
    ['one byte changed', BODY.replace('entry', 'entrx'), HEADER],
    ['no sha256= prefix', BODY, HEADER.slice(7)],
    ['upper-case hex', BODY, `sha256=${HEADER.slice(7).toUpperCase()}`],
    ['no header', BODY, undefined],
    ['a header of another length', BODY, `${HEADER}00`],
    ['the same JSON re-serialised with another key order', '{"entry":[],"object":"whatsapp_business_account"}', HEADER],
  ])('refuses %s', (_label, body, header) => {
    expect(ok(SECRET, body, header)).toBe(false);
  });
  it('refuses everything with an empty secret, and a missing body', () => {
    expect(ok('', BODY, HEADER)).toBe(false);
    expect(verifyMetaSignature(SECRET, undefined, HEADER)).toBe(false);
  });
});

describe('guards', () => {
  const ctx = (headers: Record<string, string>, rawBody?: Buffer) =>
    ({ switchToHttp: () => ({ getRequest: () => ({ headers, rawBody }) }) }) as unknown as ExecutionContext;

  it('WaReadyGuard answers 404 until the channel is enabled with every key', () => {
    expect(() => new WaReadyGuard(waConfig({})).canActivate()).toThrow(NotFoundException);
    expect(() => new WaReadyGuard(waConfig({ ...WA_ENV, WA_ACCESS_TOKEN: '' })).canActivate()).toThrow(NotFoundException);
    expect(new WaReadyGuard(waConfig()).canActivate()).toBe(true);
  });

  it('MetaSignatureGuard admits the signed raw body and nothing else', () => {
    const guard = new MetaSignatureGuard(waConfig());
    expect(guard.canActivate(ctx({ 'x-hub-signature-256': HEADER }, Buffer.from(BODY)))).toBe(true);
    expect(() => guard.canActivate(ctx({}, Buffer.from(BODY)))).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(ctx({ 'x-hub-signature-256': HEADER }))).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(ctx({ 'x-hub-signature-256': ['x'] as unknown as string }, Buffer.from(BODY)))).toThrow(UnauthorizedException);
  });
});

describe('webhook controller', () => {
  const webhook = { handle: jest.fn() };
  const controller = new WhatsappWebhookController(waConfig(), webhook as never);

  it('answers the challenge only for the right mode and the right token', () => {
    expect(controller.verify({ 'hub.mode': 'subscribe', 'hub.verify_token': 'verify-me', 'hub.challenge': '12345' })).toBe('12345');
    expect(() => controller.verify({ 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong', 'hub.challenge': '1' })).toThrow(ForbiddenException);
    expect(() => controller.verify({ 'hub.mode': 'subscribe', 'hub.verify_token': 'verify-mX', 'hub.challenge': '1' })).toThrow(ForbiddenException);
    expect(() => controller.verify({ 'hub.mode': 'unsubscribe', 'hub.verify_token': 'verify-me' })).toThrow(ForbiddenException);
    expect(() => controller.verify({ 'hub.mode': 'subscribe' })).toThrow(ForbiddenException);
    expect(controller.verify({ 'hub.mode': 'subscribe', 'hub.verify_token': 'verify-me' })).toBe('');
  });

  it('hands a verified body to the service and acknowledges', async () => {
    await expect(controller.receive({ entry: [] })).resolves.toEqual({ ok: true });
    expect(webhook.handle).toHaveBeenCalledWith({ entry: [] });
  });
});

describe('internal controller', () => {
  const whatsapp = { processQueue: jest.fn() };
  const admin = { purgeMessages: jest.fn().mockResolvedValue({ deleted: 3 }), purgeInbound: jest.fn().mockResolvedValue({ deleted: 4 }), purgeConsents: jest.fn().mockResolvedValue({ deleted: 5 }) };
  const on = new WhatsappInternalController(waConfig(), whatsapp as never, admin as never);
  const off = new WhatsappInternalController(waConfig({}), whatsapp as never, admin as never);

  it('the sweep does nothing and says so while the channel is off (a 404 would page every minute)', async () => {
    await expect(off.processQueue()).resolves.toEqual({ off: true, claimed: 0 });
    expect(whatsapp.processQueue).not.toHaveBeenCalled();
  });

  it('the sweep reports ok unless every claimed row failed', async () => {
    whatsapp.processQueue.mockResolvedValueOnce({ claimed: 0, sent: 0, retry: 0, failed: 0, cancelled: 0 });
    expect(await on.processQueue()).toMatchObject({ ok: true });
    whatsapp.processQueue.mockResolvedValueOnce({ claimed: 2, sent: 1, retry: 0, failed: 1, cancelled: 0 });
    expect(await on.processQueue()).toMatchObject({ ok: true });
    whatsapp.processQueue.mockResolvedValueOnce({ claimed: 2, sent: 0, retry: 0, failed: 2, cancelled: 0 });
    expect(await on.processQueue()).toMatchObject({ ok: false });
  });

  it('the three purges run with the cutoff, also while the channel is off', async () => {
    const cutoff = '2026-06-01T00:00:00.000Z';
    await expect(off.purgeMessages({ cutoff })).resolves.toEqual({ deleted: 3 });
    await expect(off.purgeInbound({ cutoff })).resolves.toEqual({ deleted: 4 });
    await expect(off.purgeConsents({ cutoff })).resolves.toEqual({ deleted: 5 });
    expect(admin.purgeMessages).toHaveBeenCalledWith(new Date(cutoff));
  });
});

describe('consent service', () => {
  let consent: FakeConsent;
  let service: WhatsappConsentService;
  const build = (env = WA_ENV) => {
    consent = new FakeConsent();
    const tx = new FakeTx(consent, new FakeMessages(), new FakeCaps());
    service = new WhatsappConsentService(waConfig(env), consent, tx);
  };
  beforeEach(() => build());
  const grant = (phone: string, customerId: string | null, purpose: 'UTILITY' | 'MARKETING', granted = true, waNumber = '1', recordedAt?: Date) =>
    consent.append({ phone, customerId, waNumber, purpose, legalEntity: 'PT', granted, textVersion: 'v', source: waNumber === '2' ? 'AIWEB' : 'APP', sourceRef: `${consent.rows.length}`, depotId: null, recordedAt });

  it('makes a 30 minute code and the wa.me link to number 1 with DAFTAR prefilled', async () => {
    const made = await service.createCode({ kind: 'SELF', createdBy: 'c1', customerId: 'c1', depotId: null });
    expect(made.code).toMatch(/^[2-9A-HJ-NP-Z]{8}$/);
    expect(made.link).toBe(`https://wa.me/6281100000000?text=DAFTAR%20${made.code}`);
    expect(made.expiresAt.getTime() - Date.now()).toBeGreaterThan(29 * 60_000);
  });

  it('shows a cashier only the state of their own code', async () => {
    const made = await service.createCode({ kind: 'CASHIER', createdBy: 'u1', customerId: null, depotId: 'd1' });
    await expect(service.codeState(made.id, 'u1')).resolves.toEqual({ state: 'WAITING', depotId: 'd1' });
    await expect(service.codeState(made.id, 'u2')).rejects.toThrow(NotFoundException);
    await expect(service.codeState('nope', 'u1')).rejects.toThrow(NotFoundException);
    consent.codes[0].expiresAt = new Date(Date.now() - 1);
    await expect(service.codeState(made.id, 'u1')).resolves.toEqual({ state: 'EXPIRED', depotId: 'd1' });
    consent.codes[0].usedAt = new Date();
    await expect(service.codeState(made.id, 'u1')).resolves.toEqual({ state: 'USED', depotId: 'd1' });
  });

  it('shows the customer their state with the number masked, and lets them withdraw', async () => {
    await expect(service.me('c1')).resolves.toEqual({ state: 'NONE', phone: null });
    await expect(service.revoke('c1')).resolves.toEqual({ revoked: false });
    await grant('6281234567890', 'c1', 'UTILITY');
    await expect(service.me('c1')).resolves.toEqual({ state: 'GRANTED', phone: '+62 8xx-xxxx-7890' });
    await expect(service.revoke('c1')).resolves.toEqual({ revoked: true });
    await expect(service.me('c1')).resolves.toMatchObject({ state: 'STOPPED' });
    await expect(service.revoke('c1')).resolves.toEqual({ revoked: false });
    expect(maskWaPhone('6281234567890')).toBe('+62 8xx-xxxx-7890');
  });

  it('contact state: OPTED_IN only for granted marketing, STOPPED for a stop, NONE for the rest and for a bad number', async () => {
    await grant('6281000000001', null, 'UTILITY');
    await grant('6281000000001', null, 'MARKETING');
    await grant('6281000000002', null, 'MARKETING');
    await grant('6281000000002', null, 'MARKETING', false);
    await grant('6281000000003', null, 'UTILITY');
    await expect(service.contactStates(['0811000000001', '+6281000000002', '6281000000003', 'abc', '6281000000009'])).resolves.toEqual({
      '0811000000001': 'NONE',
      '+6281000000002': 'STOPPED',
      '6281000000003': 'NONE',
      abc: 'NONE',
      '6281000000009': 'NONE',
    });
    await expect(service.contactStates(['081000000001'])).resolves.toEqual({ '081000000001': 'OPTED_IN' });
    await expect(service.contactStates(['6281000000001'])).resolves.toEqual({ '6281000000001': 'OPTED_IN' });
  });

  it('contact state says NONE for everyone while the channel is off', async () => {
    await grant('6281000000001', null, 'UTILITY');
    await grant('6281000000001', null, 'MARKETING');
    build({ ...WA_ENV, WA_ENABLED: '' });
    await grant('6281000000001', null, 'MARKETING');
    await expect(service.contactStates(['6281000000001'])).resolves.toEqual({ '6281000000001': 'NONE' });
  });

  it('serves the STOP list with ids, pages by cursor, and stamps the peer clock on every call', async () => {
    await grant('6281000000001', 'c1', 'UTILITY', false);
    await grant('6281000000001', 'c1', 'MARKETING', false);
    await grant('6281000000009', null, 'MARKETING', false, '2');
    const first = await service.optOutsAfter(0, 1);
    expect(first.items).toHaveLength(1);
    // a STOP wrote both purposes; only MARKETING leaves with waOptOutSync
    expect(first.items[0]).toMatchObject({ phone: '6281000000001', purpose: 'MARKETING', granted: false, seq: 2 });
    expect(first.items[0].id).toEqual(expect.any(String));
    expect(first.nextAfter).toBe(2);
    const rest = await service.optOutsAfter(first.nextAfter, 500);
    expect(rest.items).toEqual([]);
    expect(rest.nextAfter).toBe(2);
    expect(consent.peer?.lastSeq).toBe(2n);
    const empty = await service.optOutsAfter(50, 500);
    expect(empty).toEqual({ items: [], nextAfter: 50 });
    expect(consent.peer?.lastSeq).toBe(50n);
  });

  it('takes the AI web\'s number-2 STOP idempotently, on its own time, and a later PROMO on number 1 can lift it', async () => {
    const item = { eventId: 'wa2:1', phone: '081234567890', granted: false, recordedAt: '2026-11-27T01:00:00.000Z' };
    await expect(service.acceptOptOuts([item])).resolves.toEqual({ accepted: 1, duplicates: 0 });
    await expect(service.acceptOptOuts([item])).resolves.toEqual({ accepted: 0, duplicates: 1 });
    expect(consent.rows).toHaveLength(1);
    expect(consent.rows[0]).toMatchObject({ phone: '6281234567890', waNumber: '2', purpose: 'MARKETING', granted: false, source: 'AIWEB', sourceRef: 'wa2:1', customerId: null });
    expect(consent.rows[0].recordedAt).toEqual(new Date('2026-11-27T01:00:00.000Z'));
    // never from the future
    await service.acceptOptOuts([{ ...item, eventId: 'wa2:2', recordedAt: '2999-01-01T00:00:00.000Z' }]);
    expect(consent.rows[1].recordedAt.getTime()).toBeLessThanOrEqual(Date.now());
    // the AI web's own rows are not in the feed back to it
    await expect(service.optOutsAfter(0, 500)).resolves.toMatchObject({ items: [] });
  });

  it('refuses the whole batch for a phone that cannot be messaged and writes nothing', async () => {
    await expect(service.acceptOptOuts([{ eventId: 'a', phone: '0811', granted: false, recordedAt: '2026-11-29T01:00:00.000Z' }])).rejects.toThrow(BadRequestException);
    expect(consent.rows).toEqual([]);
  });
});

describe('admin service', () => {
  const caps = new FakeCaps();
  const templates = new FakeTemplates();
  const messages = new FakeMessages();
  const consent = new FakeConsent();
  const build = (env = WA_ENV) => new WhatsappAdminService(waConfig(env), caps, templates, messages, consent);

  it('lists every category with its month count, the ten templates as DRAFT, and shows "no rate" as null cost', async () => {
    caps.setCap('UTILITY', { monthlyMessages: 100, rateIdr: 250 });
    caps.setCap('MARKETING', { monthlyMessages: 10 });
    await caps.reserve('1', new Date().toISOString().slice(0, 7), 'UTILITY').catch(() => undefined);
    const view: WaOverview = await build().overview();
    expect(view.state).toBe('ON');
    expect(view.categories.map((c) => c.category)).toEqual(['UTILITY', 'MARKETING', 'AUTHENTICATION', 'SERVICE']);
    expect(view.categories[0]).toMatchObject({ monthlyMessages: 100, rateIdr: 250 });
    expect(view.categories[1].costIdr).toBeNull();
    expect(view.categories[2]).toMatchObject({ monthlyMessages: null, paused: false, messages: 0, costIdr: null });
    expect(view.templates).toHaveLength(WA_UTILITY_EVENTS.length);
    expect(view.templates.every((t: WaTemplateRecord) => t.status === 'DRAFT')).toBe(true);
    expect(WA_UTILITY_EVENTS.every((e) => templates.rows.some((t) => t.name === WA_TEMPLATE_SPECS[e].name))).toBe(true);
  });

  it('reports OFF, INCOMPLETE (names only) and PAUSED', async () => {
    expect((await build({}).overview()).state).toBe('OFF');
    const incomplete = await build({ ...WA_ENV, WA_APP_SECRET: '' }).overview();
    expect(incomplete).toMatchObject({ state: 'INCOMPLETE', missing: ['WA_APP_SECRET'] });
    await build().setPaused(true, 'u1');
    expect((await build().overview()).state).toBe('PAUSED');
    await build().setPaused(false, 'u1');
    expect((await build().overview()).state).toBe('ON');
  });

  it('shows the newest refusals and failures, and sets a cap, a pause and a template state', async () => {
    await messages.insertIfNew({ notificationId: null, dedupeKey: 'k1', customerId: null, phone: '', waNumber: '1', category: 'UTILITY', templateName: 't', language: 'id', vars: {}, status: 'SKIPPED', skipReason: 'CAP', monthKey: '2026-11' });
    expect((await build().overview()).problems).toEqual([expect.objectContaining({ status: 'SKIPPED', skipReason: 'CAP' })]);
    await build().setCap('SERVICE', { monthlyMessages: 5, rateIdr: null, monthlyCostIdr: null }, 'u1');
    expect(caps.caps.get('1|SERVICE')).toMatchObject({ monthlyMessages: 5 });
    await expect(build().setCap('NOPE', { monthlyMessages: 1, rateIdr: null, monthlyCostIdr: null }, 'u1')).rejects.toThrow(BadRequestException);
    await expect(build().setTemplateStatus('hm_order_confirmed', 'id', 'APPROVED', null)).resolves.toBe(true);
    await expect(build().setTemplateStatus('hm_order_confirmed', 'id', 'WEIRD', null)).rejects.toThrow(BadRequestException);
  });

  it('runs the three retention purges', async () => {
    const cutoff = new Date('2026-01-01T00:00:00.000Z');
    jest.spyOn(consent, 'purgeBefore').mockResolvedValue(9);
    await expect(build().purgeMessages(cutoff)).resolves.toEqual({ deleted: 3 });
    await expect(build().purgeInbound(cutoff)).resolves.toEqual({ deleted: 4 });
    await expect(build().purgeConsents(cutoff)).resolves.toEqual({ deleted: 9 });
  });
});

describe('controllers delegate', () => {
  const consent = {
    createCode: jest.fn().mockResolvedValue({ code: 'X' }),
    codeState: jest.fn().mockResolvedValue({ state: 'WAITING', depotId: null }),
    me: jest.fn().mockResolvedValue({ state: 'NONE', phone: null }),
    revoke: jest.fn().mockResolvedValue({ revoked: false }),
    contactStates: jest.fn().mockResolvedValue({}),
    optOutsAfter: jest.fn().mockResolvedValue({ items: [], nextAfter: 0 }),
    acceptOptOuts: jest.fn().mockResolvedValue({ accepted: 1, duplicates: 0 }),
  };
  const admin = { overview: jest.fn(), setCap: jest.fn(), setPaused: jest.fn().mockResolvedValue(3), setTemplateStatus: jest.fn().mockResolvedValue(true) };
  const user = { sub: 'u1' } as never;
  const controller = new WhatsappController(waConfig(), consent as never, admin as never);

  it('status says on only when ready', () => {
    expect(controller.status()).toEqual({ enabled: true });
    expect(new WhatsappController(waConfig({}), consent as never, admin as never).status()).toEqual({ enabled: false });
  });

  it('routes the customer, the cashier and HQ to the services with the caller as the actor', async () => {
    await controller.selfCode({ sub: 'c1' } as never);
    expect(consent.createCode).toHaveBeenLastCalledWith({ kind: 'SELF', createdBy: 'c1', customerId: 'c1', depotId: null });
    await controller.cashierCode(user, { depotId: 'd1' });
    expect(consent.createCode).toHaveBeenLastCalledWith({ kind: 'CASHIER', createdBy: 'u1', customerId: null, depotId: 'd1' });
    await controller.cashierCode(user, { depotId: 'd1', customerId: 'c9' });
    expect(consent.createCode).toHaveBeenLastCalledWith({ kind: 'CASHIER', createdBy: 'u1', customerId: 'c9', depotId: 'd1' });
    consent.codeState.mockResolvedValueOnce({ state: 'WAITING', depotId: 'd1' });
    await expect(controller.codeState({ sub: 'u1', role: 'KEPALA_DEPOT', depotId: 'd1', depotIds: ['d1'] } as never, 'id1')).resolves.toEqual({ state: 'WAITING' });
    expect(consent.codeState).toHaveBeenCalledWith('id1', 'u1');
    // a cashier of another depot is refused even for a code they somehow made
    consent.codeState.mockResolvedValueOnce({ state: 'WAITING', depotId: 'd2' });
    await expect(controller.codeState({ sub: 'u1', role: 'KEPALA_DEPOT', depotId: 'd1', depotIds: ['d1'] } as never, 'id1')).rejects.toThrow(ForbiddenException);
    await controller.me(user);
    await controller.revoke(user);
    await controller.contactState({ phones: ['1'] });
    expect(consent.contactStates).toHaveBeenCalledWith(['1']);
    await controller.overview();
    await controller.setCap(user, 'UTILITY', { monthlyMessages: 5 });
    expect(admin.setCap).toHaveBeenCalledWith('UTILITY', { monthlyMessages: 5, rateIdr: null, monthlyCostIdr: null }, 'u1');
    await controller.setCap(user, 'UTILITY', { monthlyMessages: 5, rateIdr: 100, monthlyCostIdr: 900 });
    expect(admin.setCap).toHaveBeenLastCalledWith('UTILITY', { monthlyMessages: 5, rateIdr: 100, monthlyCostIdr: 900 }, 'u1');
    await expect(controller.pause(user, { paused: true })).resolves.toEqual({ rows: 3 });
    await expect(controller.templateStatus({ name: 'n', language: 'id', status: 'APPROVED' })).resolves.toEqual({ updated: true });
    expect(admin.setTemplateStatus).toHaveBeenCalledWith('n', 'id', 'APPROVED', null);
  });

  it('the STOP-list routes use the defaults of the contract', async () => {
    const sync = new WhatsappSyncController(consent as never);
    await sync.list({});
    expect(consent.optOutsAfter).toHaveBeenLastCalledWith(0, 500);
    await sync.list({ after: 7, limit: 20 });
    expect(consent.optOutsAfter).toHaveBeenLastCalledWith(7, 20);
    await expect(sync.accept({ items: [] })).resolves.toEqual({ accepted: 1, duplicates: 0 });
  });
});

describe('reply texts and parameters', () => {
  it('builds a parameter list in spec order, one line each, with a fallback only for the name', () => {
    expect(buildTemplateParams(['name', 'orderNumber'], { name: 'Budi\n  Santoso', orderNumber: ' HM-1 ' })).toEqual(['Budi Santoso', 'HM-1']);
    expect(buildTemplateParams(['name', 'orderNumber'], { orderNumber: 'HM-1' })).toEqual(['Pelanggan', 'HM-1']);
    expect(buildTemplateParams(['name', 'orderNumber'], { name: 'Budi', orderNumber: '   ' })).toBeNull();
  });

  it('the registration reply is the consent text with the legal entity filled in', () => {
    expect(waRegisteredReply('PT Contoh')).toContain('Hydromart (PT Contoh)');
    expect(WA_REPLY_CODE_INVALID).toContain('Kode tidak berlaku');
  });
});

describe('Meta sender adapter', () => {
  const adapter = new MetaWhatsappSenderAdapter(waConfig());
  const reply = (status: number, body: unknown) => ({ ok: status < 300, status, json: async () => body }) as unknown as Response;
  let fetchMock: jest.SpyInstance;
  beforeEach(() => {
    fetchMock = jest.spyOn(global, 'fetch');
  });
  afterEach(() => fetchMock.mockRestore());

  it('posts the template to the graph URL of number 1 with the token in the header only', async () => {
    fetchMock.mockResolvedValue(reply(200, { messages: [{ id: 'wamid.1' }] }));
    await expect(adapter.sendTemplate({ to: '6281', name: 'hm_order_confirmed', language: 'id', params: ['A', 'B'] })).resolves.toEqual({ ok: true, messageId: 'wamid.1' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://graph.facebook.com/v21.0/1111/messages');
    expect(String(url)).not.toContain('tok-secret');
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer tok-secret' });
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      messaging_product: 'whatsapp',
      to: '6281',
      type: 'template',
      template: { name: 'hm_order_confirmed', language: { code: 'id' }, components: [{ type: 'body', parameters: [{ type: 'text', text: 'A' }, { type: 'text', text: 'B' }] }] },
    });
  });

  it('posts free text for a service reply', async () => {
    fetchMock.mockResolvedValue(reply(200, { messages: [{ id: 'wamid.2' }] }));
    await adapter.sendText({ to: '6281', body: 'Halo' });
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toMatchObject({ type: 'text', text: { body: 'Halo' } });
  });

  it.each([
    ['a permanent 4xx (undeliverable)', 400, { error: { code: 131026, message: 'secret detail 6281234' } }, true, '131026'],
    ['a template error', 400, { error: { code: 132001 } }, true, '132001'],
    ['a throttle (429)', 429, { error: { code: 4 } }, false, '4'],
    ['a load code on a 4xx', 400, { error: { code: 130429 } }, false, '130429'],
    ['a server error', 503, {}, false, null],
    ['a 200 with no message id', 200, {}, true, null],
  ])('%s', async (_label, status, body, permanent, code) => {
    fetchMock.mockResolvedValue(reply(status, body));
    const out = await adapter.sendText({ to: '6281', body: 'x' });
    expect(out).toMatchObject({ ok: false, permanent, code });
    // Meta's message text can carry a phone number; only the code is kept.
    expect(JSON.stringify(out)).not.toContain('6281234');
    expect(JSON.stringify(out)).not.toContain('tok-secret');
  });

  it('a network error and a timeout are passing failures', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    await expect(adapter.sendText({ to: '6281', body: 'x' })).resolves.toEqual({ ok: false, permanent: false, code: null, error: 'network' });
    fetchMock.mockRejectedValueOnce(Object.assign(new Error('timed out'), { name: 'TimeoutError' }));
    await expect(adapter.sendText({ to: '6281', body: 'x' })).resolves.toEqual({ ok: false, permanent: false, code: null, error: 'timeout' });
  });

  it('a body that is not JSON is still a refusal, never a throw', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 502, json: async () => Promise.reject(new Error('html')) } as unknown as Response);
    await expect(adapter.sendText({ to: '6281', body: 'x' })).resolves.toMatchObject({ ok: false, permanent: false });
  });
});
