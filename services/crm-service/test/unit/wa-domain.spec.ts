import { ConfigService } from '@nestjs/config';

import { CrmConfigService } from '../../src/config/crm-config.service';
import { envValidationSchema } from '../../src/config/env.validation';
import {
  APPROVER_CAP_FOR_EVENT,
  OPS_EVENTS,
  OVERSEER_EVENTS,
  PERSONAL_OPS_EVENTS,
  STAFF_TOGGLE_FOR_EVENT,
  templateFor,
} from '../../src/domain/notification-event';
import {
  WA_CONSENT_SOURCES,
  WA_CONSENT_TEXT_ID,
  WA_CONSENT_TEXT_VERSION,
  WA_OPT_IN_CODE_LENGTH,
  WaConsentRow,
  canSendMarketing,
  consentState,
  currentConsents,
  generateOptInCode,
  parseKeyword,
  utilityConsentForCustomer,
} from '../../src/domain/wa-consent';
import { WaCapLimits, estimatedCostIdr, rateFor, reservation, warnThreshold } from '../../src/domain/wa-cost';
import { normalizeWaPhone } from '../../src/domain/wa-phone';
import { WA_TEMPLATE_SPECS, WA_UTILITY_EVENTS, isWaUtilityEvent } from '../../src/domain/wa-templates';

describe('normalizeWaPhone', () => {
  it.each(['0812-3456-7890', '6281234567890', '+62 812 3456 7890', ' 081234567890 '])('%s -> 6281234567890', (raw) => {
    expect(normalizeWaPhone(raw)).toBe('6281234567890');
  });

  it.each(['', 'abc', '12345', '0211234567', '+1 415 555 0100', '6212345'])('%s is not a mobile number', (raw) => {
    expect(normalizeWaPhone(raw)).toBeNull();
  });
});

describe('parseKeyword', () => {
  it.each(['STOP', ' stop. ', 'Berhenti!', 'unsub'])('%s stops', (text) => {
    expect(parseKeyword(text)).toEqual({ kind: 'STOP' });
  });

  it('reads MULAI and PROMO, whole message only', () => {
    expect(parseKeyword('mulai')).toEqual({ kind: 'START' });
    expect(parseKeyword('Promo')).toEqual({ kind: 'PROMO' });
  });

  it('is not fooled by a sentence that contains a keyword', () => {
    expect(parseKeyword('Stop saya')).toEqual({ kind: 'OTHER' });
    expect(parseKeyword('tolong STOP kirim promo')).toEqual({ kind: 'OTHER' });
    expect(parseKeyword('')).toEqual({ kind: 'OTHER' });
  });

  it('reads DAFTAR with an eight character code, any case and spacing', () => {
    expect(parseKeyword('DAFTAR AB23CD45')).toEqual({ kind: 'REGISTER', code: 'AB23CD45' });
    expect(parseKeyword('  daftar   ab23cd45!! ')).toEqual({ kind: 'REGISTER', code: 'AB23CD45' });
    expect(parseKeyword('DAFTAR AB23')).toEqual({ kind: 'OTHER' });
    expect(parseKeyword('DAFTAR')).toEqual({ kind: 'OTHER' });
  });
});

let seq = 0n;
const row = (over: Partial<WaConsentRow>): WaConsentRow => ({
  seq: (seq += 1n),
  phone: '6281234567890',
  customerId: null,
  waNumber: '1',
  purpose: 'UTILITY',
  granted: true,
  ...over,
});

describe('currentConsents / consentState', () => {
  it('the newest row by seq wins, even when the rows arrive out of order', () => {
    const stop = row({ granted: false });
    const grant = row({ granted: true });
    const current = currentConsents([grant, stop]);
    expect([...current.values()]).toEqual([grant]);
    expect(consentState([grant, stop], '6281234567890', 'UTILITY')).toBe('GRANTED');
    expect(consentState([stop, grant, row({ granted: false })], '6281234567890', 'UTILITY')).toBe('STOPPED');
  });

  it('never asked is NONE, not STOPPED', () => {
    expect(consentState([], '6281234567890', 'UTILITY')).toBe('NONE');
    expect(consentState([row({ phone: '6289999999999' })], '6281234567890', 'UTILITY')).toBe('NONE');
    expect(consentState([row({ purpose: 'MARKETING' })], '6281234567890', 'UTILITY')).toBe('NONE');
  });

  it('UTILITY is per number 1: a number 2 row does not count', () => {
    expect(consentState([row({ waNumber: '2' })], '6281234567890', 'UTILITY')).toBe('NONE');
  });

  it('a MARKETING stop on EITHER number counts everywhere', () => {
    const grant = row({ purpose: 'MARKETING' });
    expect(consentState([grant], '6281234567890', 'MARKETING')).toBe('GRANTED');
    expect(consentState([grant, row({ purpose: 'MARKETING', waNumber: '2', granted: false })], '6281234567890', 'MARKETING')).toBe(
      'STOPPED',
    );
    // ... and a grant on number 2 alone gives number 1 nothing.
    expect(consentState([row({ purpose: 'MARKETING', waNumber: '2' })], '6281234567890', 'MARKETING')).toBe('NONE');
    // the customer who said STOP on 2 and then PROMO again on 2 is allowed again
    expect(
      consentState(
        [grant, row({ purpose: 'MARKETING', waNumber: '2', granted: false }), row({ purpose: 'MARKETING', waNumber: '2' })],
        '6281234567890',
        'MARKETING',
      ),
    ).toBe('GRANTED');
  });
});

describe('utilityConsentForCustomer', () => {
  it('finds the phone the customer opted in with, and goes STOPPED on a newer stop', () => {
    const grant = row({ customerId: 'c1', phone: '6281111111111' });
    expect(utilityConsentForCustomer([grant], 'c1')).toEqual({ state: 'GRANTED', phone: '6281111111111' });
    const stop = row({ customerId: 'c1', phone: '6281111111111', granted: false });
    expect(utilityConsentForCustomer([stop, grant], 'c1')).toEqual({ state: 'STOPPED', phone: '6281111111111' });
  });

  it('ignores other customers, other purposes and number 2', () => {
    const rows = [
      row({ customerId: 'c2' }),
      row({ customerId: 'c1', purpose: 'MARKETING' }),
      row({ customerId: 'c1', waNumber: '2' }),
    ];
    expect(utilityConsentForCustomer(rows, 'c1')).toEqual({ state: 'NONE', phone: null });
  });
});

describe('canSendMarketing', () => {
  const now = new Date('2026-11-29T03:00:00.000Z');
  const phone = '6281234567890';
  const grant = row({ purpose: 'MARKETING' });
  const ok = (over: Partial<Parameters<typeof canSendMarketing>[0]>) =>
    canSendMarketing({ rows: [grant], phone, peerLastOkAt: new Date(now.getTime() - 60_000), now, maxAgeSeconds: 180, ...over });

  it('is true only when granted AND the peer is fresh', () => {
    expect(ok({})).toEqual({ ok: true });
    expect(ok({ peerLastOkAt: new Date(now.getTime() - 180_000) })).toEqual({ ok: true });
  });

  it('a stale or absent peer holds the message', () => {
    expect(ok({ peerLastOkAt: new Date(now.getTime() - 181_000) })).toEqual({ ok: false, reason: 'PEER_STOP_UNKNOWN' });
    expect(ok({ peerLastOkAt: null })).toEqual({ ok: false, reason: 'PEER_STOP_UNKNOWN' });
  });

  it('stopped and never asked block regardless of the peer', () => {
    expect(ok({ rows: [grant, row({ purpose: 'MARKETING', granted: false })] })).toEqual({ ok: false, reason: 'STOPPED' });
    expect(ok({ rows: [] })).toEqual({ ok: false, reason: 'NO_CONSENT' });
    expect(ok({ rows: [], peerLastOkAt: null })).toEqual({ ok: false, reason: 'NO_CONSENT' });
  });
});

describe('opt-in code and consent text', () => {
  it('is eight characters from an alphabet without 0, O, 1 or I, and does not repeat over 10k draws', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i += 1) {
      const code = generateOptInCode();
      expect(code).toHaveLength(WA_OPT_IN_CODE_LENGTH);
      expect(code).toMatch(/^[2-9A-HJ-NP-Z]{8}$/);
      seen.add(code);
    }
    expect(seen.size).toBe(10_000);
  });

  it('a generated code parses back out of the message the customer sends', () => {
    const code = generateOptInCode();
    expect(parseKeyword(`DAFTAR ${code}`)).toEqual({ kind: 'REGISTER', code });
  });

  it('carries a version and the PT placeholder, and names every source the ledger takes', () => {
    expect(WA_CONSENT_TEXT_VERSION).toBe('2026-11-29');
    expect(WA_CONSENT_TEXT_ID).toContain('{PT}');
    expect(WA_CONSENT_SOURCES).toEqual(['APP', 'CASHIER_QR', 'KEYWORD', 'AIWEB', 'STAFF_REVOKE', 'ERASURE']);
  });
});

describe('cost and cap functions', () => {
  const cap = (over: Partial<WaCapLimits> = {}): WaCapLimits => ({
    monthlyMessages: 5,
    rateIdr: null,
    monthlyCostIdr: null,
    paused: false,
    ...over,
  });

  it('warns at 80% of the cap, rounded up', () => {
    expect(warnThreshold(5)).toBe(4);
    expect(warnThreshold(10)).toBe(8);
    expect(warnThreshold(1)).toBe(1);
  });

  it('SERVICE replies are counted at rate 0, the rest at the HQ rate (which may be unset)', () => {
    expect(rateFor('SERVICE', cap({ rateIdr: 400 }))).toBe(0);
    expect(rateFor('UTILITY', cap({ rateIdr: 400 }))).toBe(400);
    expect(rateFor('UTILITY', cap())).toBeNull();
  });

  it('shows no cost until a rate is entered', () => {
    expect(estimatedCostIdr(10, null)).toBeNull();
    expect(estimatedCostIdr(3, 12.5)).toBe(37.5);
  });

  it('no cap row means no send, a paused row stops, the message cap is exact', () => {
    expect(reservation(null, { messages: 0, costIdr: 0 }, null)).toEqual({ ok: false, reason: 'CAP' });
    expect(reservation(cap({ paused: true }), { messages: 0, costIdr: 0 }, null)).toEqual({ ok: false, reason: 'PAUSED' });
    expect(reservation(cap({ monthlyMessages: 3 }), { messages: 2, costIdr: 0 }, null)).toMatchObject({
      ok: true,
      messages: 3,
      reachesCap: true,
    });
    expect(reservation(cap({ monthlyMessages: 3 }), { messages: 3, costIdr: 0 }, null)).toEqual({ ok: false, reason: 'CAP' });
  });

  it('flags the 80% crossing without reaching the cap', () => {
    expect(reservation(cap(), { messages: 3, costIdr: 0 }, null)).toMatchObject({ ok: true, warn: true, reachesCap: false });
    expect(reservation(cap(), { messages: 2, costIdr: 0 }, null)).toMatchObject({ ok: true, warn: false });
  });

  it('enforces the cost cap only when a rate is set', () => {
    const limits = cap({ monthlyMessages: 100, rateIdr: 500, monthlyCostIdr: 1000 });
    expect(reservation(limits, { messages: 1, costIdr: 500 }, 500)).toMatchObject({ ok: true, costIdr: 1000 });
    expect(reservation(limits, { messages: 2, costIdr: 1000 }, 500)).toEqual({ ok: false, reason: 'CAP' });
    // no rate: the same counters pass, there is nothing to add up
    expect(reservation(cap({ monthlyMessages: 100, monthlyCostIdr: 1000 }), { messages: 2, costIdr: 5000 }, null)).toMatchObject({
      ok: true,
      costIdr: 5000,
    });
    // a cost cap with no rate on the row is no cost cap
    expect(reservation(cap({ monthlyMessages: 100 }), { messages: 2, costIdr: 5000 }, 500)).toMatchObject({ ok: true });
  });
});

describe('WA_TEMPLATE_SPECS / WA_UTILITY_EVENTS', () => {
  it('has one spec per utility event, and the list is exactly the specs', () => {
    expect(WA_UTILITY_EVENTS).toHaveLength(10);
    expect(WA_UTILITY_EVENTS.sort()).toEqual(Object.keys(WA_TEMPLATE_SPECS).sort());
    expect(isWaUtilityEvent('ORDER_CONFIRMED')).toBe(true);
    expect(isWaUtilityEvent('ORDER_RECEIVED')).toBe(false);
  });

  it('never contains an ops or staff event', () => {
    const staff = new Set<string>([
      ...OPS_EVENTS,
      ...PERSONAL_OPS_EVENTS,
      ...OVERSEER_EVENTS,
      ...Object.keys(STAFF_TOGGLE_FOR_EVENT),
      ...Object.keys(APPROVER_CAP_FOR_EVENT),
    ]);
    expect(WA_UTILITY_EVENTS.filter((e) => staff.has(e))).toEqual([]);
  });

  it.each(WA_UTILITY_EVENTS)('%s: parameters match the notification tokens and the body numbers them in order', (event) => {
    const spec: { name: string; body: string; params: readonly string[]; language: string; category: string } = WA_TEMPLATE_SPECS[event];
    const tokens = [...templateFor(event, 'id').matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);
    expect([...new Set(tokens)].sort()).toEqual([...spec.params].sort());
    expect([...spec.body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]))).toEqual(spec.params.map((_, i) => i + 1));
    // what Meta Manager accepts: lowercase underscore name, one line, does not start or end on a parameter
    expect(spec.name).toMatch(/^[a-z_]+$/);
    expect(spec.body).not.toMatch(/\n|^\{\{|\}\}$/);
    expect([spec.language, spec.category]).toEqual(['id', 'UTILITY']);
  });

  it('template names are unique', () => {
    const names = WA_UTILITY_EVENTS.map((e) => WA_TEMPLATE_SPECS[e].name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('WhatsApp env: all blank is off', () => {
  const cfg = (values: Record<string, string>): CrmConfigService =>
    new CrmConfigService({
      get: <T>(key: string, def?: T): T => (key in values ? (values[key] as unknown as T) : (def as T)),
    } as unknown as ConfigService);
  const FULL = {
    WA_ENABLED: 'true',
    WA_ACCESS_TOKEN: ' tok ',
    WA_APP_SECRET: 'sec',
    WA_VERIFY_TOKEN: 'ver',
    WA_PHONE_NUMBER_ID_1: '111',
    WA_WABA_ID_1: '222',
    WA_GRAPH_VERSION: 'v21.0',
    WA_NUMBER_1_E164: '6281234567890',
    WA_LEGAL_ENTITY_NAME: 'PT Contoh',
  };

  it('nothing set: not enabled, not ready, nothing reported missing', () => {
    expect(cfg({}).whatsapp).toMatchObject({ enabled: false, ready: false, missing: [], peerMaxAgeSeconds: 180 });
    expect(cfg({ ...FULL, WA_ENABLED: 'false' }).whatsapp).toMatchObject({ enabled: false, ready: false });
  });

  it('enabled but incomplete: not ready, and the missing key NAMES are listed', () => {
    const { WA_APP_SECRET, WA_LEGAL_ENTITY_NAME, ...rest } = FULL;
    expect(WA_APP_SECRET && WA_LEGAL_ENTITY_NAME).toBeTruthy();
    expect(cfg(rest).whatsapp).toMatchObject({ enabled: true, ready: false, missing: ['WA_APP_SECRET', 'WA_LEGAL_ENTITY_NAME'] });
    expect(cfg({ ...FULL, WA_VERIFY_TOKEN: '   ' }).whatsapp.missing).toEqual(['WA_VERIFY_TOKEN']);
  });

  it('enabled and complete: ready, values trimmed, the peer age falls back on junk', () => {
    expect(cfg({ ...FULL, WA_ENABLED: ' TRUE ' }).whatsapp).toMatchObject({ enabled: true, ready: true, missing: [], accessToken: 'tok' });
    expect(cfg({ ...FULL, WA_PEER_MAX_AGE_SECONDS: '300' }).whatsapp.peerMaxAgeSeconds).toBe(300);
    expect(cfg({ ...FULL, WA_PEER_MAX_AGE_SECONDS: 'abc' }).whatsapp.peerMaxAgeSeconds).toBe(180);
    expect(cfg({ ...FULL, WA_PEER_MAX_AGE_SECONDS: '0' }).whatsapp.peerMaxAgeSeconds).toBe(180);
  });

  it('the env schema accepts every WA_ key blank, in production too', () => {
    const keys = ['WA_ENABLED', 'WA_ACCESS_TOKEN', 'WA_APP_SECRET', 'WA_VERIFY_TOKEN', 'WA_PHONE_NUMBER_ID_1', 'WA_WABA_ID_1', 'WA_GRAPH_VERSION', 'WA_NUMBER_1_E164', 'WA_LEGAL_ENTITY_NAME', 'WA_PEER_MAX_AGE_SECONDS'];
    const blank = Object.fromEntries(keys.map((k) => [k, '']));
    for (const env of [{ NODE_ENV: 'production', ...blank }, { NODE_ENV: 'development', ...blank }]) {
      const flagged = (envValidationSchema.validate(env, { abortEarly: false, allowUnknown: true }).error?.details ?? []).map((d) => String(d.path[0]));
      expect(flagged.filter((k) => k.startsWith('WA_'))).toEqual([]);
    }
  });
});
