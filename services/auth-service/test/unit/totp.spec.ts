import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { AuditService } from '../../src/application/services/audit.service';
import { OtpService } from '../../src/application/services/otp.service';
import {
  MAX_TOTP_FAILURES,
  SECOND_FACTOR_TICKET_TTL_SECONDS,
  TOTP_LOCK_SECONDS,
  TotpService,
} from '../../src/application/services/totp.service';
import { envValidationSchema } from '../../src/config/env.validation';
import { Customer } from '../../src/domain/customer/customer.entity';
import { Role } from '../../src/domain/customer/role.enum';
import {
  base32,
  hotp,
  matchStep,
  newRecoveryCodes,
  parseTotpKey,
  recoveryCodeHash,
  sealSecret,
  signTicket,
  stepAt,
  ticketValid,
  totpKeys,
  unsealSecret,
} from '../../src/infrastructure/security/totp';
import { HandoffTokenDto } from '../../src/modules/auth/dto/external-access.dto';
import { TotpConfirmDto } from '../../src/modules/auth/dto/totp.dto';
import { TotpController } from '../../src/modules/auth/totp.controller';
import {
  FakeClock,
  FakeCrypto,
  FakeOtpDelivery,
  InMemoryAuditLogRepository,
  InMemoryCustomerRepository,
  InMemoryOtpTokenRepository,
  InMemoryTotpRepository,
  buildTestConfig,
  makeCustomer,
} from '../support/fakes';

const KEY = Buffer.alloc(32, 7).toString('base64');
const NOW = new Date('2026-11-23T02:00:10.000Z');
const ctx = { ipAddress: '10.0.0.1', userAgent: 'jest' };
const RFC_SECRET = Buffer.from('12345678901234567890');

describe('TOTP arithmetic (RFC 4226 / 6238)', () => {
  it('matches the RFC 6238 SHA-1 test vectors, last six digits', () => {
    const vectors: [number, string][] = [
      [59, '287082'],
      [1111111109, '081804'],
      [1111111111, '050471'],
      [1234567890, '005924'],
      [2000000000, '279037'],
      [20000000000, '353130'],
    ];
    for (const [seconds, code] of vectors) {
      expect(hotp(RFC_SECRET, stepAt(seconds * 1000))).toBe(code);
    }
  });

  it('writes base32 as RFC 4648 does, without padding', () => {
    const vectors = ['', 'f', 'fo', 'foo', 'foob', 'fooba', 'foobar'];
    const expected = ['', 'MY', 'MZXQ', 'MZXW6', 'MZXW6YQ', 'MZXW6YTB', 'MZXW6YTBOI'];
    expect(vectors.map((v) => base32(Buffer.from(v)))).toEqual(expected);
  });

  it('accepts a code one step either side of now, and nothing further', () => {
    const now = 1_000_000 * 30_000;
    const step = stepAt(now);
    expect(matchStep(RFC_SECRET, hotp(RFC_SECRET, step), now, null)).toBe(step);
    expect(matchStep(RFC_SECRET, hotp(RFC_SECRET, step - 1), now, null)).toBe(step - 1);
    expect(matchStep(RFC_SECRET, hotp(RFC_SECRET, step + 1), now, null)).toBe(step + 1);
    expect(matchStep(RFC_SECRET, hotp(RFC_SECRET, step - 2), now, null)).toBeNull();
    expect(matchStep(RFC_SECRET, '12345', now, null)).toBeNull();
    expect(matchStep(RFC_SECRET, 'abcdef', now, null)).toBeNull();
  });

  it('never accepts a step at or before the last one accepted', () => {
    const now = 1_000_000 * 30_000;
    const step = stepAt(now);
    expect(matchStep(RFC_SECRET, hotp(RFC_SECRET, step), now, step)).toBeNull();
    expect(matchStep(RFC_SECRET, hotp(RFC_SECRET, step + 1), now, step)).toBe(step + 1);
  });

  it('takes a 32-byte base64 key and refuses anything else', () => {
    expect(parseTotpKey(KEY)).toHaveLength(32);
    expect(() => parseTotpKey('c2hvcnQ=')).toThrow('32 bytes');
    expect(() => parseTotpKey(`${KEY}x`)).toThrow('32 bytes');
  });

  it('derives two different keys, the same every time', () => {
    const a = totpKeys(parseTotpKey(KEY));
    const b = totpKeys(parseTotpKey(KEY));
    expect(a.seal.equals(b.seal)).toBe(true);
    expect(a.seal.equals(a.mac)).toBe(false);
  });

  it('opens a sealed secret only for the account it was sealed for, untouched', () => {
    const { seal } = totpKeys(parseTotpKey(KEY));
    const sealed = sealSecret(seal, RFC_SECRET, 'account-a');
    expect(unsealSecret(seal, sealed, 'account-a').equals(RFC_SECRET)).toBe(true);
    expect(() => unsealSecret(seal, sealed, 'account-b')).toThrow();
    const [v, iv, tag, body] = sealed.split('.');
    const flipped = `${body!.slice(0, -2)}${body!.endsWith('AA') ? 'BB' : 'AA'}`;
    expect(() => unsealSecret(seal, [v, iv, tag, flipped].join('.'), 'account-a')).toThrow();
    // A tag cut down to 4 bytes is refused outright, not checked on its first bytes.
    const short = Buffer.from(tag!, 'base64url').subarray(0, 4).toString('base64url');
    expect(() => unsealSecret(seal, [v, iv, short, body].join('.'), 'account-a')).toThrow();
    expect(Buffer.from(tag!, 'base64url')).toHaveLength(16);
    for (const bad of ['v2.a.b.c', 'v1.a.b', 'v1.a.b.c.d', 'v1..b.c']) {
      expect(() => unsealSecret(seal, bad, 'account-a')).toThrow('not a sealed TOTP secret');
    }
  });

  it('hands out ten distinct recovery codes, and hashes them however they are typed', () => {
    const codes = newRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) expect(code).toMatch(/^[A-Z2-7]{5}-[A-Z2-7]{5}$/);
    const { mac } = totpKeys(parseTotpKey(KEY));
    const code = codes[0]!;
    const typed = ` ${code.toLowerCase().replace('-', ' ')} `;
    expect(recoveryCodeHash(mac, typed)).toBe(recoveryCodeHash(mac, code));
    expect(recoveryCodeHash(Buffer.alloc(32, 1), code)).not.toBe(recoveryCodeHash(mac, code));
  });

  it('accepts a ticket only for its account and enrolment, inside its lifetime', () => {
    const { mac } = totpKeys(parseTotpKey(KEY));
    const enrolment = 'v1.sealed-secret';
    const now = NOW.getTime();
    const exp = Math.floor(now / 1000) + 3600;
    const ticket = signTicket(mac, 'a', enrolment, exp);
    expect(ticketValid(mac, ticket, 'a', enrolment, now, 7200)).toBe(true);
    expect(ticketValid(mac, ticket, 'b', enrolment, now, 7200)).toBe(false);
    expect(ticketValid(mac, ticket, 'a', 'v1.another-secret', now, 7200)).toBe(false);
    expect(ticketValid(mac, ticket, 'a', enrolment, now + 3_601_000, 7200)).toBe(false);
    // A lifetime longer than the policy allows is refused even with a good signature.
    expect(ticketValid(mac, ticket, 'a', enrolment, now, 1800)).toBe(false);
    expect(ticketValid(mac, `${ticket}x`, 'a', enrolment, now, 7200)).toBe(false);
    for (const bad of ['', 'abc', `${exp}`, `${exp}.x.y`, `soon.${ticket.split('.')[1]}`]) {
      expect(ticketValid(mac, bad, 'a', enrolment, now, 7200)).toBe(false);
    }
  });
});

function setup(env: Record<string, string> = { TOTP_ENCRYPTION_KEY: KEY }) {
  const config = buildTestConfig(env);
  const repo = new InMemoryTotpRepository();
  const customers = new InMemoryCustomerRepository();
  const auditLog = new InMemoryAuditLogRepository();
  const clock = new FakeClock(NOW);
  const sms = new FakeOtpDelivery();
  // The store's createdAt must come from the same clock as the service's now: from the real
  // clock, a fixed NOW became a date bomb the day it was written for.
  const otp = new OtpService(
    new InMemoryOtpTokenRepository(() => clock.now()),
    sms,
    new FakeCrypto(),
    clock,
    config,
  );
  const service = new TotpService(repo, customers, clock, new AuditService(auditLog), config, otp);
  const person = (role: Role): Customer => {
    const customer = makeCustomer({ role });
    customers.seed(customer);
    return customer;
  };
  /** The code the person's app shows right now. */
  const appCode = (customerId: string): string => {
    const secret = unsealSecret(config.totpKeys!.seal, repo.rows.get(customerId)!.secretSealed, customerId);
    return hotp(secret, stepAt(clock.now().getTime()));
  };
  /** A 6-digit code the app shows for none of the three steps that would be accepted now. */
  const wrongCode = (customerId: string): string => {
    const secret = unsealSecret(config.totpKeys!.seal, repo.rows.get(customerId)!.secretSealed, customerId);
    const step = stepAt(clock.now().getTime());
    const live = [step - 1, step, step + 1].map((s) => hotp(secret, s));
    return ['000000', '111111', '222222', '333333'].find((c) => !live.includes(c))!;
  };
  /** Sets up an authenticator and moves 30 seconds on, so the next code is a fresh one. */
  const enrol = async (customer: Customer): Promise<string[]> => {
    const caller = { sub: customer.id, role: customer.role };
    await service.startEnrolment(caller, ctx);
    const { recoveryCodes } = await service.confirmEnrolment(
      caller,
      appCode(customer.id),
      sms.lastCode!,
      ctx,
    );
    clock.advance(30);
    return recoveryCodes;
  };
  const actions = () => auditLog.entries.map((e) => e.action);
  const last = () => auditLog.entries[auditLog.entries.length - 1]!;
  return { config, repo, customers, auditLog, clock, sms, service, person, appCode, wrongCode, enrol, actions, last };
}

describe('TotpService enrolment', () => {
  it('reports the status: available, required by role, enrolled, codes left, lock', async () => {
    const off = setup({});
    const finance = off.person(Role.FINANCE);
    await expect(off.service.status({ sub: finance.id, role: finance.role })).resolves.toEqual({
      available: false,
      required: true,
      enrolled: false,
      recoveryCodesLeft: 0,
      lockedUntil: null,
    });

    const t = setup();
    const manager = t.person(Role.MANAGER);
    await t.enrol(manager);
    const caller = { sub: manager.id, role: manager.role };
    const status = await t.service.status(caller);
    expect(status).toMatchObject({ available: true, required: false, enrolled: true, recoveryCodesLeft: 10 });

    const lockedUntil = new Date(t.clock.now().getTime() + 60_000);
    t.repo.rows.get(manager.id)!.lockedUntil = lockedUntil;
    expect((await t.service.status(caller)).lockedUntil).toBe(lockedUntil.toISOString());
    t.clock.advance(61);
    expect((await t.service.status(caller)).lockedUntil).toBeNull();
  });

  it('starts with a fresh secret shown once and an SMS code to the account number', async () => {
    const t = setup();
    const director = t.person(Role.DIREKTUR);
    const result = await t.service.startEnrolment({ sub: director.id, role: director.role }, ctx);
    expect(result.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(result.otpauthUri).toBe(
      `otpauth://totp/${encodeURIComponent(`HYDROMART:${director.phone}`)}?secret=${result.secret}` +
        '&issuer=HYDROMART&algorithm=SHA1&digits=6&period=30',
    );
    expect(result.sms).toMatchObject({ expiresInSeconds: 300 });
    expect(t.sms.sent).toEqual([expect.objectContaining({ phone: director.phone, purpose: 'TOTP_ENROLMENT' })]);
    // Stored sealed, never as the text the person saw.
    expect(t.repo.rows.get(director.id)!.secretSealed).not.toContain(result.secret);
    expect(t.actions()).toEqual(['auth.totp.enrolment_started']);

    // Starting again (once the SMS cooldown is over) replaces the secret.
    t.clock.advance(60);
    const again = await t.service.startEnrolment({ sub: director.id, role: director.role }, ctx);
    expect(again.secret).not.toBe(result.secret);
  });

  it('refuses customers, unknown accounts, and everyone while switched off', async () => {
    const t = setup();
    const customer = t.person(Role.CUSTOMER);
    await expect(
      t.service.startEnrolment({ sub: customer.id, role: customer.role }, ctx),
    ).rejects.toMatchObject({ code: 'AUTH_HANDOFF_STAFF_ONLY' });
    const nobody = { sub: '00000000-0000-4000-8000-000000000000', role: Role.FINANCE };
    await expect(t.service.startEnrolment(nobody, ctx)).rejects.toMatchObject({
      code: 'AUTH_CUSTOMER_NOT_FOUND',
    });

    const off = setup({});
    const finance = off.person(Role.FINANCE);
    const caller = { sub: finance.id, role: finance.role };
    await expect(off.service.startEnrolment(caller, ctx)).rejects.toMatchObject({ code: 'AUTH_TOTP_OFF' });
    await expect(off.service.confirmEnrolment(caller, '123456', '123456', ctx)).rejects.toMatchObject({
      code: 'AUTH_TOTP_OFF',
    });
    expect(off.sms.sent).toHaveLength(0);
  });

  it('confirms with the app code and the SMS code, hands out ten recovery codes once, then holds', async () => {
    const t = setup();
    const finance = t.person(Role.FINANCE);
    const caller = { sub: finance.id, role: finance.role };
    await expect(t.service.confirmEnrolment(caller, '123456', '123456', ctx)).rejects.toMatchObject({
      code: 'AUTH_TOTP_NOT_STARTED',
    });

    const codes = await t.enrol(finance);
    expect(codes).toHaveLength(10);
    expect(t.actions()).toEqual(['auth.totp.enrolment_started', 'auth.totp.enrolled']);
    // An enrolled account is refused before any SMS is sent.
    await expect(t.service.startEnrolment(caller, ctx)).rejects.toMatchObject({ code: 'AUTH_TOTP_ENROLLED' });
    expect(t.sms.sent).toHaveLength(1);
    await expect(
      t.service.confirmEnrolment(caller, t.appCode(finance.id), '123456', ctx),
    ).rejects.toMatchObject({ code: 'AUTH_TOTP_ENROLLED' });
  });

  it('a stolen session without the phone cannot bind its app: the SMS code is required', async () => {
    const t = setup();
    const hq = t.person(Role.HEAD_OFFICE);
    const caller = { sub: hq.id, role: hq.role };
    await t.service.startEnrolment(caller, ctx);
    await expect(t.service.confirmEnrolment(caller, t.appCode(hq.id), '999999', ctx)).rejects.toMatchObject({
      code: 'AUTH_OTP_INVALID',
    });
    expect(t.last()).toMatchObject({
      action: 'auth.otp.failed',
      metadata: { purpose: 'TOTP_ENROLMENT', reason: 'OtpInvalidError' },
    });
    expect(t.repo.rows.get(hq.id)!.confirmedAt).toBeNull();
    // The app code is checked first, so a typo there leaves the SMS code unspent.
    await expect(
      t.service.confirmEnrolment(caller, t.wrongCode(hq.id), t.sms.lastCode!, ctx),
    ).rejects.toMatchObject({ code: 'AUTH_TOTP_INVALID' });
    await expect(
      t.service.confirmEnrolment(caller, t.appCode(hq.id), t.sms.lastCode!, ctx),
    ).resolves.toMatchObject({ recoveryCodes: expect.any(Array) });
  });

  it('the account vanishing between the two steps is a 404', async () => {
    const t = setup();
    const finance = t.person(Role.FINANCE);
    const caller = { sub: finance.id, role: finance.role };
    await t.service.startEnrolment(caller, ctx);
    t.customers.rows.delete(finance.id);
    await expect(t.service.confirmEnrolment(caller, '123456', '123456', ctx)).rejects.toMatchObject({
      code: 'AUTH_CUSTOMER_NOT_FOUND',
    });
  });

  it('wrong first codes are counted and recorded; the fifth locks for 15 minutes', async () => {
    const t = setup();
    const finance = t.person(Role.FINANCE);
    const caller = { sub: finance.id, role: finance.role };
    await t.service.startEnrolment(caller, ctx);
    const wrong = t.wrongCode(finance.id);
    for (let i = 0; i < MAX_TOTP_FAILURES; i += 1) {
      await expect(t.service.confirmEnrolment(caller, wrong, '123456', ctx)).rejects.toMatchObject({
        code: 'AUTH_TOTP_INVALID',
      });
    }
    expect(t.last().metadata).toEqual({ step: 'enrolment', reason: 'wrong', attempt: 5, locked: true });
    await expect(
      t.service.confirmEnrolment(caller, t.appCode(finance.id), '123456', ctx),
    ).rejects.toMatchObject({ code: 'AUTH_TOTP_LOCKED', details: { retryAfterSeconds: TOTP_LOCK_SECONDS } });
    expect(t.last().metadata).toEqual({ step: 'enrolment', reason: 'locked' });

    t.clock.advance(TOTP_LOCK_SECONDS);
    await t.service.startEnrolment(caller, ctx);
    await expect(
      t.service.confirmEnrolment(caller, t.appCode(finance.id), t.sms.lastCode!, ctx),
    ).resolves.toBeDefined();
  });

  it('an enrolment confirmed between the check and the write is still refused', async () => {
    const t = setup();
    const finance = t.person(Role.FINANCE);
    jest.spyOn(t.repo, 'startEnrolment').mockResolvedValueOnce(false);
    await expect(
      t.service.startEnrolment({ sub: finance.id, role: finance.role }, ctx),
    ).rejects.toMatchObject({ code: 'AUTH_TOTP_ENROLLED' });
  });

  it('a confirmation that loses a race to another one says start again', async () => {
    const t = setup();
    const finance = t.person(Role.FINANCE);
    const caller = { sub: finance.id, role: finance.role };
    await t.service.startEnrolment(caller, ctx);
    jest.spyOn(t.repo, 'confirm').mockResolvedValueOnce(false);
    await expect(
      t.service.confirmEnrolment(caller, t.appCode(finance.id), t.sms.lastCode!, ctx),
    ).rejects.toMatchObject({ code: 'AUTH_TOTP_NOT_STARTED' });
  });
});

describe('TotpService reset', () => {
  it('only another SUPER_ADMIN resets; refusals and resets are recorded with the target', async () => {
    const t = setup();
    const admin = t.person(Role.SUPER_ADMIN);
    const other = t.person(Role.SUPER_ADMIN);
    await t.enrol(other);
    const hq = t.person(Role.HEAD_OFFICE);

    await expect(t.service.reset({ sub: hq.id, role: hq.role }, other.id, ctx)).rejects.toMatchObject({
      code: 'AUTH_TOTP_RESET_FORBIDDEN',
    });
    expect(t.last()).toMatchObject({ success: false, metadata: { targetId: other.id, reason: 'role' } });
    await expect(t.service.reset({ sub: other.id, role: other.role }, other.id, ctx)).rejects.toMatchObject({
      code: 'AUTH_TOTP_RESET_FORBIDDEN',
    });
    expect(t.last()).toMatchObject({ success: false, metadata: { reason: 'own-account' } });
    await expect(
      t.service.reset({ sub: admin.id, role: admin.role }, '00000000-0000-4000-8000-000000000000', ctx),
    ).rejects.toMatchObject({ code: 'AUTH_CUSTOMER_NOT_FOUND' });

    await expect(t.service.reset({ sub: admin.id, role: admin.role }, other.id, ctx)).resolves.toEqual({
      removed: true,
    });
    expect(t.repo.rows.has(other.id)).toBe(false);
    expect(t.repo.codes).toHaveLength(0);
    expect(t.last()).toMatchObject({
      customerId: admin.id,
      action: 'auth.totp.reset',
      success: true,
      metadata: { targetId: other.id, removed: true },
    });
    await expect(t.service.reset({ sub: admin.id, role: admin.role }, other.id, ctx)).resolves.toEqual({
      removed: false,
    });
  });
});

describe('TotpService at the handoff', () => {
  it('asks nothing of a role that does not need it and never set one up', async () => {
    const t = setup({});
    const manager = t.person(Role.MANAGER);
    await expect(t.service.checkHandoff(manager, {}, ctx)).resolves.toEqual({ kind: 'not-needed' });
  });

  it('a role that needs it: off is 503, not set up is 403, nothing sent asks for it', async () => {
    const off = setup({});
    await expect(off.service.checkHandoff(off.person(Role.HEAD_OFFICE), {}, ctx)).rejects.toMatchObject({
      code: 'AUTH_TOTP_OFF',
    });
    const t = setup();
    const hq = t.person(Role.HEAD_OFFICE);
    await expect(t.service.checkHandoff(hq, { totp: '123456' }, ctx)).rejects.toMatchObject({
      code: 'AUTH_TOTP_ENROLMENT_REQUIRED',
    });
    await t.enrol(hq);
    await expect(t.service.checkHandoff(hq, {}, ctx)).resolves.toEqual({ kind: 'missing' });
  });

  it('holds anyone who set one up to it, whatever their role', async () => {
    const t = setup();
    const manager = t.person(Role.MANAGER);
    await t.enrol(manager);
    await expect(t.service.checkHandoff(manager, {}, ctx)).resolves.toEqual({ kind: 'missing' });
  });

  it('passes on the app code once, with a 12-hour ticket; the same code again fails', async () => {
    const t = setup();
    const hq = t.person(Role.HEAD_OFFICE);
    await t.enrol(hq);
    const code = t.appCode(hq.id);
    const passed = await t.service.checkHandoff(hq, { totp: code }, ctx);
    expect(passed).toMatchObject({ kind: 'totp', ticketExpiresIn: SECOND_FACTOR_TICKET_TTL_SECONDS });
    await expect(t.service.checkHandoff(hq, { totp: code }, ctx)).rejects.toMatchObject({
      code: 'AUTH_TOTP_INVALID',
    });
    expect(t.last().metadata).toEqual({ step: 'handoff', reason: 'wrong', attempt: 1, locked: false });
  });

  it('a ticket stands in for the code until it runs out or the enrolment changes', async () => {
    const t = setup();
    const hq = t.person(Role.HEAD_OFFICE);
    await t.enrol(hq);
    const passed = await t.service.checkHandoff(hq, { totp: t.appCode(hq.id) }, ctx);
    const ticket = (passed as { ticket: string }).ticket;
    await expect(t.service.checkHandoff(hq, { ticket }, ctx)).resolves.toEqual({ kind: 'ticket' });

    // A reset and a new enrolment void it, even inside its 12 hours.
    const admin = t.person(Role.SUPER_ADMIN);
    await t.service.reset({ sub: admin.id, role: admin.role }, hq.id, ctx);
    await t.enrol(hq);
    await expect(t.service.checkHandoff(hq, { ticket }, ctx)).resolves.toEqual({ kind: 'missing' });

    const fresh = await t.service.checkHandoff(hq, { totp: t.appCode(hq.id) }, ctx);
    const next = (fresh as { ticket: string }).ticket;
    t.clock.advance(SECOND_FACTOR_TICKET_TTL_SECONDS);
    await expect(t.service.checkHandoff(hq, { ticket: next }, ctx)).resolves.toEqual({ kind: 'missing' });
  });

  it('a recovery code works once, is recorded with how many are left, and gives a ticket', async () => {
    const t = setup();
    const director = t.person(Role.DIREKTUR);
    const [first] = await t.enrol(director);
    const passed = await t.service.checkHandoff(director, { recoveryCode: first!.toLowerCase() }, ctx);
    expect(passed).toMatchObject({ kind: 'recovery', ticketExpiresIn: SECOND_FACTOR_TICKET_TTL_SECONDS });
    expect(t.last()).toMatchObject({ action: 'auth.totp.recovery_code_used', metadata: { left: 9 } });
    await expect(t.service.checkHandoff(director, { recoveryCode: first! }, ctx)).rejects.toMatchObject({
      code: 'AUTH_TOTP_INVALID',
    });
  });

  it('five wrong codes lock it; a locked step refuses before comparing; a ticket still passes', async () => {
    const t = setup();
    const hq = t.person(Role.HEAD_OFFICE);
    await t.enrol(hq);
    const ticket = ((await t.service.checkHandoff(hq, { totp: t.appCode(hq.id) }, ctx)) as { ticket: string })
      .ticket;
    for (let i = 0; i < MAX_TOTP_FAILURES; i += 1) {
      await expect(t.service.checkHandoff(hq, { recoveryCode: 'AAAAA-AAAAA' }, ctx)).rejects.toMatchObject({
        code: 'AUTH_TOTP_INVALID',
      });
    }
    t.clock.advance(30);
    await expect(t.service.checkHandoff(hq, { totp: t.appCode(hq.id) }, ctx)).rejects.toMatchObject({
      code: 'AUTH_TOTP_LOCKED',
    });
    expect(t.last().metadata).toEqual({ step: 'handoff', reason: 'locked' });
    await expect(t.service.checkHandoff(hq, {}, ctx)).rejects.toMatchObject({ code: 'AUTH_TOTP_LOCKED' });
    await expect(t.service.checkHandoff(hq, { ticket }, ctx)).resolves.toEqual({ kind: 'ticket' });

    t.clock.advance(TOTP_LOCK_SECONDS);
    await expect(t.service.checkHandoff(hq, { totp: t.appCode(hq.id) }, ctx)).resolves.toMatchObject({
      kind: 'totp',
    });
    expect(t.repo.rows.get(hq.id)!.failedAttempts).toBe(0);
  });

  it('a burst of parallel guesses: at most five are compared, the rest lock it', async () => {
    const t = setup();
    const hq = t.person(Role.HEAD_OFFICE);
    await t.enrol(hq);
    const compared = jest.spyOn(t.repo, 'spendRecoveryCode');
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, () => t.service.checkHandoff(hq, { recoveryCode: 'AAAAA-AAAAA' }, ctx)),
    );
    const codes = results.map((r) => (r as PromiseRejectedResult).reason.code);
    expect(codes.filter((c) => c === 'AUTH_TOTP_INVALID')).toHaveLength(MAX_TOTP_FAILURES);
    expect(codes.filter((c) => c === 'AUTH_TOTP_LOCKED')).toHaveLength(12 - MAX_TOTP_FAILURES);
    expect(compared).toHaveBeenCalledTimes(MAX_TOTP_FAILURES);
    expect(t.repo.rows.get(hq.id)!.lockedUntil).not.toBeNull();
  });

  it('a lock set by a parallel request after this one read the row is still honoured', async () => {
    const t = setup();
    const hq = t.person(Role.HEAD_OFFICE);
    await t.enrol(hq);
    // The row reads unlocked, then the claim finds it locked: someone else just locked it.
    jest.spyOn(t.repo, 'claimAttempt').mockResolvedValueOnce(null);
    await expect(t.service.checkHandoff(hq, { totp: t.appCode(hq.id) }, ctx)).rejects.toMatchObject({
      code: 'AUTH_TOTP_LOCKED',
      details: { retryAfterSeconds: TOTP_LOCK_SECONDS },
    });
    // And when the row it read already showed the lock, the time left comes from it.
    const until = new Date(t.clock.now().getTime() + 120_000);
    const row = t.repo.rows.get(hq.id)!;
    const caller = { sub: hq.id, role: hq.role };
    jest.spyOn(t.repo, 'find').mockResolvedValueOnce({ ...row, confirmedAt: null, lockedUntil: until });
    jest.spyOn(t.repo, 'claimAttempt').mockResolvedValueOnce(null);
    await expect(t.service.confirmEnrolment(caller, '123456', '123456', ctx)).rejects.toMatchObject({
      code: 'AUTH_TOTP_LOCKED',
      details: { retryAfterSeconds: 120 },
    });
  });
});

describe('TotpController', () => {
  it('passes each call through with the caller and the request context', async () => {
    const service = {
      status: jest.fn().mockResolvedValue({ enrolled: false }),
      startEnrolment: jest.fn().mockResolvedValue({ secret: 'S', otpauthUri: 'otpauth://x' }),
      confirmEnrolment: jest.fn().mockResolvedValue({ recoveryCodes: [] }),
      reset: jest.fn().mockResolvedValue({ removed: true }),
    };
    const controller = new TotpController(service as unknown as TotpService);
    const user = { sub: 'u1', role: Role.SUPER_ADMIN, phone: '+62811' };
    const req = { ip: '10.0.0.9', headers: { 'user-agent': 'jest' } } as never;

    await expect(controller.status(user)).resolves.toEqual({ enrolled: false });
    await controller.startEnrolment(user, req);
    await controller.confirmEnrolment(user, { code: '123456', smsCode: '654321' }, req);
    await controller.reset(user, 'target', req);
    expect(service.status).toHaveBeenCalledWith(user);
    expect(service.startEnrolment).toHaveBeenCalledWith(user, expect.objectContaining({ userAgent: 'jest' }));
    expect(service.confirmEnrolment).toHaveBeenCalledWith(user, '123456', '654321', expect.any(Object));
    expect(service.reset).toHaveBeenCalledWith(user, 'target', expect.any(Object));
  });
});

describe('HD-4 request shapes', () => {
  const errorsOf = async (cls: new () => object, body: object): Promise<string[]> =>
    (await validate(plainToInstance(cls, body))).map((e) => e.property);

  it('the handoff takes a 6-digit app code, a recovery code, or a ticket', async () => {
    const base = { code: 'c'.repeat(43), codeVerifier: 'v'.repeat(43) };
    expect(await errorsOf(HandoffTokenDto, base)).toEqual([]);
    expect(await errorsOf(HandoffTokenDto, { ...base, totp: '012345' })).toEqual([]);
    expect(await errorsOf(HandoffTokenDto, { ...base, recoveryCode: 'abcde-fgh23' })).toEqual([]);
    expect(await errorsOf(HandoffTokenDto, { ...base, secondFactorTicket: '1.x' })).toEqual([]);
    expect(await errorsOf(HandoffTokenDto, { ...base, totp: 'dddddd' })).toEqual(['totp']);
    expect(await errorsOf(HandoffTokenDto, { ...base, totp: '12345' })).toEqual(['totp']);
    expect(await errorsOf(HandoffTokenDto, { ...base, recoveryCode: 'AAAAA-AAAA1' })).toEqual(['recoveryCode']);
  });

  it('confirming takes the app code and the SMS code, both digits', async () => {
    expect(await errorsOf(TotpConfirmDto, { code: '123456', smsCode: '654321' })).toEqual([]);
    expect(await errorsOf(TotpConfirmDto, { code: 'dddddd', smsCode: 'x' })).toEqual(['code', 'smsCode']);
  });
});

describe('TOTP_ENCRYPTION_KEY', () => {
  const base = {
    AUTH_DATABASE_URL: 'postgresql://u:p@localhost:5432/db?schema=public',
    JWT_ACCESS_SECRET: 'test-access-secret-that-is-long-enough-01',
    JWT_REFRESH_SECRET: 'test-refresh-secret-that-is-long-enough-1',
    OTP_PEPPER: 'test-otp-pepper-value',
    INTERNAL_SERVICE_KEY: 'test-internal-service-key-0123456',
  };

  it('boots blank or with 32 base64 bytes, and refuses anything else', () => {
    expect(envValidationSchema.validate(base).error).toBeUndefined();
    expect(envValidationSchema.validate({ ...base, TOTP_ENCRYPTION_KEY: KEY }).error).toBeUndefined();
    expect(envValidationSchema.validate({ ...base, TOTP_ENCRYPTION_KEY: 'not-a-key' }).error).toBeDefined();
  });

  it('is read once per value and is null while blank', () => {
    expect(buildTestConfig({}).totpKeys).toBeNull();
    const config = buildTestConfig({ TOTP_ENCRYPTION_KEY: KEY });
    expect(config.totpKeys).toBe(config.totpKeys);
  });
});
