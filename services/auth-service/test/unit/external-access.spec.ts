import { aiWebReturnUrl } from '../../src/config/env.validation';
import { createHash, createPublicKey, generateKeyPairSync, type KeyObject } from 'node:crypto';

import { verifyExternalToken } from '@hydromart/platform';

import { AuditService } from '../../src/application/services/audit.service';
import {
  EXTERNAL_TOKEN_TTL_SECONDS,
  ExternalAccessService,
} from '../../src/application/services/external-access.service';
import { OtpService } from '../../src/application/services/otp.service';
import { SECOND_FACTOR_TICKET_TTL_SECONDS, TotpService } from '../../src/application/services/totp.service';
import {
  machineSecretLive,
  parseMachineAccounts,
  parseSigningKey,
  publicJwk,
} from '../../src/config/external-access';
import { envValidationSchema } from '../../src/config/env.validation';
import { CustomerStatus } from '../../src/domain/customer/customer-status.enum';
import { Role } from '../../src/domain/customer/role.enum';
import { ExternalTokenSigner } from '../../src/infrastructure/security/external-token-signer';
import { hotp, stepAt, unsealSecret } from '../../src/infrastructure/security/totp';
import { ExternalAccessController } from '../../src/modules/auth/external-access.controller';
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

const NOW = new Date();
const DAY = 86_400_000;
const ACCOUNT_ID = '7d2c3f64-1e0b-4a59-9b7e-2f1f8c7a6d10';
const SECRET = 'n8n-secret-that-is-long-enough-to-pass-0001';
const sha = (v: string) => createHash('sha256').update(v).digest('hex');
const challengeOf = (verifier: string) => createHash('sha256').update(verifier).digest('base64url');
const VERIFIER = 'v'.repeat(43);
const ctx = { ipAddress: '10.0.0.1', userAgent: 'jest' };

const keyB64 = (curve = 'prime256v1') =>
  generateKeyPairSync('ec', { namedCurve: curve })
    .privateKey.export({ format: 'der', type: 'pkcs8' })
    .toString('base64');

const machine = (over: Record<string, unknown> = {}) => ({
  id: ACCOUNT_ID,
  name: 'n8n',
  secretSha256: sha(SECRET),
  scopes: ['hqConsole'],
  notAfter: new Date(NOW.getTime() + 30 * DAY).toISOString(),
  ...over,
});

/** The keys a service would hold after reading this signer's JWKS. */
function verifierKeys(signer: ExternalTokenSigner): Map<string, KeyObject> {
  return new Map(
    signer.jwks().keys.map((k) => [
      k.kid,
      createPublicKey({ key: { kty: k.kty, crv: k.crv, x: k.x, y: k.y }, format: 'jwk' }),
    ]),
  );
}

/** AI-3b: the one address a handoff code may go to. */
const RETURN = 'https://ai.example.test/masuk/callback';

function setup(env: Record<string, string> = {}) {
  const config = buildTestConfig({
    AI_TOKEN_SIGNING_KEY: keyB64(),
    AI_WEB_RETURN_URL: RETURN,
    MACHINE_ACCOUNTS: JSON.stringify([machine()]),
    TOTP_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'),
    ...env,
  });
  const signer = new ExternalTokenSigner(config);
  const customers = new InMemoryCustomerRepository();
  const auditLog = new InMemoryAuditLogRepository();
  const clock = new FakeClock(NOW);
  const audit = new AuditService(auditLog);
  const totpRepo = new InMemoryTotpRepository();
  const sms = new FakeOtpDelivery();
  const otp = new OtpService(new InMemoryOtpTokenRepository(), sms, new FakeCrypto(), clock, config);
  const totp = new TotpService(totpRepo, customers, clock, audit, config, otp);
  const service = new ExternalAccessService(customers, clock, signer, audit, config, totp);
  // A role the authenticator step does not apply to; HD-4 below covers the ones it does.
  const staff = makeCustomer({ role: Role.MANAGER, assignedDepotId: 'depot-1' });
  customers.seed(staff);
  const caller = { sub: staff.id, role: staff.role };
  return { signer, customers, auditLog, clock, service, staff, caller, totp, totpRepo, config, sms };
}

describe('external-access config', () => {
  it('accepts a P-256 key and refuses another curve', () => {
    expect(parseSigningKey(keyB64()).asymmetricKeyType).toBe('ec');
    expect(() => parseSigningKey(keyB64('secp384r1'))).toThrow('not an EC P-256');
  });

  it('names the key by its RFC 7638 thumbprint', () => {
    const jwk = publicJwk(parseSigningKey(keyB64()));
    const expected = createHash('sha256')
      .update(`{"crv":"P-256","kty":"EC","x":"${jwk.x}","y":"${jwk.y}"}`)
      .digest('base64url');
    expect(jwk).toMatchObject({ kid: expected, alg: 'ES256', use: 'sig' });
  });

  it('parses machine accounts and refuses each malformed field', () => {
    expect(parseMachineAccounts('', NOW)).toEqual([]);
    expect(parseMachineAccounts(JSON.stringify([machine()]), NOW)[0]?.scopes).toEqual(['hqConsole']);
    const bad: Array<[unknown, string]> = [
      [{}, 'JSON list'],
      [[null], '.id must be a UUID'],
      [[machine({ name: 'N8N' })], '.name'],
      [[machine({ secretSha256: 'abc' })], '.secretSha256'],
      [[machine({ scopes: [] })], 'at least one capability'],
      [[machine({ scopes: ['rootShell'] })], '"rootShell" is not a capability'],
      [[machine({ scopes: [7] })], '"7" is not a capability'],
      [[machine({ notAfter: 'soon' })], 'ISO date'],
      [[machine({ notAfter: 5 })], 'ISO date'],
      [[machine({ notAfter: new Date(NOW.getTime() + 91 * DAY).toISOString() })], '90 days'],
      [[machine(), machine({ scopes: ['staffAdmin'] })], 'repeats the id and secret'],
    ];
    for (const [value, message] of bad) {
      expect(() => parseMachineAccounts(JSON.stringify(value), NOW)).toThrow(message);
    }
    // A rotation (one id, two secrets) is allowed.
    const rotated = [machine(), machine({ secretSha256: 'b'.repeat(64) })];
    expect(parseMachineAccounts(JSON.stringify(rotated), NOW)).toHaveLength(2);
    // Malformed JSON is named without quoting the value back.
    expect(() => parseMachineAccounts('[{"id": "x", "secretSha256": "abc', NOW)).toThrow(
      /^MACHINE_ACCOUNTS is not valid JSON$/,
    );
  });

  it('a secret works until its day and never further than 90 days out', () => {
    const [account] = parseMachineAccounts(JSON.stringify([machine()]), NOW);
    expect(machineSecretLive(account!, NOW)).toBe(true);
    expect(machineSecretLive(account!, new Date(NOW.getTime() + 31 * DAY))).toBe(false);
    expect(machineSecretLive(account!, new Date(NOW.getTime() - 61 * DAY))).toBe(false);
  });

  it('boot refuses a key or an account list that does not parse, and allows both blank', () => {
    const base = {
      AUTH_DATABASE_URL: 'postgresql://u:p@localhost:5432/db?schema=public',
      JWT_ACCESS_SECRET: 'test-access-secret-that-is-long-enough-01',
      JWT_REFRESH_SECRET: 'test-refresh-secret-that-is-long-enough-1',
      OTP_PEPPER: 'test-otp-pepper-value',
      INTERNAL_SERVICE_KEY: 'test-internal-service-key-0123456',
    };
    expect(envValidationSchema.validate(base).error).toBeUndefined();
    expect(
      envValidationSchema.validate({
        ...base,
        AI_TOKEN_SIGNING_KEY: keyB64(),
        MACHINE_ACCOUNTS: JSON.stringify([machine()]),
      }).error,
    ).toBeUndefined();
    expect(
      envValidationSchema.validate({ ...base, AI_TOKEN_SIGNING_KEY: 'bm90LWEta2V5' }).error,
    ).toBeDefined();
    expect(
      envValidationSchema.validate({ ...base, AI_TOKEN_SIGNING_KEY_PREVIOUS: keyB64('secp384r1') })
        .error,
    ).toBeDefined();
    expect(envValidationSchema.validate({ ...base, MACHINE_ACCOUNTS: '[{}]' }).error).toBeDefined();
  });
});

describe('ExternalTokenSigner', () => {
  it('publishes nothing and signs nothing when switched off, the previous key included', () => {
    const signer = new ExternalTokenSigner(
      buildTestConfig({ AI_TOKEN_SIGNING_KEY: '', AI_TOKEN_SIGNING_KEY_PREVIOUS: keyB64() }),
    );
    expect(signer.enabled).toBe(false);
    expect(signer.jwks()).toEqual({ keys: [] });
    expect(() => signer.sign({ aud: 'x', sub: 'y' }, 60, NOW)).toThrow('switched off');
  });

  it('publishes the previous key beside the current one, once', () => {
    const current = keyB64();
    expect(
      new ExternalTokenSigner(
        buildTestConfig({ AI_TOKEN_SIGNING_KEY: current, AI_TOKEN_SIGNING_KEY_PREVIOUS: keyB64() }),
      ).jwks().keys,
    ).toHaveLength(2);
    expect(
      new ExternalTokenSigner(
        buildTestConfig({ AI_TOKEN_SIGNING_KEY: current, AI_TOKEN_SIGNING_KEY_PREVIOUS: current }),
      ).jwks().keys,
    ).toHaveLength(1);
  });

  it('signs what the HD-2 verifier accepts, and only under the published key', () => {
    const { signer } = setup();
    const token = signer.sign({ aud: 'hydromart-ai', sub: 's1', role: 'FINANCE' }, 900, NOW);
    expect(verifyExternalToken(token, verifierKeys(signer), NOW.getTime())).toMatchObject({
      sub: 's1',
      via: 'ai',
      role: 'FINANCE',
    });
    expect(verifyExternalToken(token, verifierKeys(setup().signer), NOW.getTime())).toBeNull();
    expect(verifyExternalToken(token, verifierKeys(signer), NOW.getTime() + 901_000)).toBeNull();
  });
});

describe('ExternalAccessService handoff', () => {
  it('trades a code and the right verifier for an AI token with the person own role', async () => {
    const { service, signer, staff, caller, auditLog } = setup();
    const { code, expiresIn } = await service.issueHandoffCode(caller, challengeOf(VERIFIER), RETURN, ctx);
    expect(expiresIn).toBe(60);

    const result = await service.exchangeHandoffCode(code, VERIFIER, ctx);
    expect(result).toMatchObject({ tokenType: 'Bearer', expiresIn: EXTERNAL_TOKEN_TTL_SECONDS });
    expect(verifyExternalToken(result.accessToken, verifierKeys(signer), NOW.getTime())).toEqual({
      sub: staff.id,
      via: 'ai',
      role: Role.MANAGER,
      depotId: 'depot-1',
      scopes: [],
    });
    expect(auditLog.entries.map((e) => e.action)).toEqual([
      'auth.handoff.code_issued',
      'auth.handoff.exchanged',
    ]);
  });

  it('spends the code on first use, so a replay fails', async () => {
    const { service, caller } = setup();
    const { code } = await service.issueHandoffCode(caller, challengeOf(VERIFIER), RETURN, ctx);
    await service.exchangeHandoffCode(code, VERIFIER, ctx);
    await expect(service.exchangeHandoffCode(code, VERIFIER, ctx)).rejects.toMatchObject({
      code: 'AUTH_HANDOFF_INVALID',
    });
  });

  it('a wrong verifier fails and spends the code too', async () => {
    const { service, caller, auditLog } = setup();
    const { code } = await service.issueHandoffCode(caller, challengeOf(VERIFIER), RETURN, ctx);
    await expect(service.exchangeHandoffCode(code, 'w'.repeat(43), ctx)).rejects.toMatchObject({
      code: 'AUTH_HANDOFF_INVALID',
    });
    await expect(service.exchangeHandoffCode(code, VERIFIER, ctx)).rejects.toMatchObject({
      code: 'AUTH_HANDOFF_INVALID',
    });
    // The second try finds no code at all: a code nobody holds gets no row (public route).
    expect(auditLog.entries.slice(1).map((e) => e.metadata?.reason)).toEqual(['verifier']);
  });

  it('a code older than 60 seconds is refused', async () => {
    const { service, caller, clock, auditLog } = setup();
    const { code } = await service.issueHandoffCode(caller, challengeOf(VERIFIER), RETURN, ctx);
    clock.advance(60);
    await expect(service.exchangeHandoffCode(code, VERIFIER, ctx)).rejects.toMatchObject({
      code: 'AUTH_HANDOFF_INVALID',
    });
    expect(auditLog.entries[1]?.metadata?.reason).toBe('expired');
  });

  it('reads the account again at exchange: gone, suspended or now a customer', async () => {
    const { service, customers, staff, caller, auditLog } = setup();
    const issue = () => service.issueHandoffCode(caller, challengeOf(VERIFIER), RETURN, ctx);

    let { code } = await issue();
    customers.rows.set(staff.id, { ...staff.toProps(), status: CustomerStatus.SUSPENDED });
    await expect(service.exchangeHandoffCode(code, VERIFIER, ctx)).rejects.toThrow('suspended');

    ({ code } = await issue());
    customers.rows.set(staff.id, { ...staff.toProps(), role: Role.CUSTOMER });
    await expect(service.exchangeHandoffCode(code, VERIFIER, ctx)).rejects.toMatchObject({
      code: 'AUTH_HANDOFF_STAFF_ONLY',
    });

    ({ code } = await issue());
    customers.rows.delete(staff.id);
    await expect(service.exchangeHandoffCode(code, VERIFIER, ctx)).rejects.toMatchObject({
      code: 'AUTH_HANDOFF_INVALID',
    });
    expect(
      auditLog.entries.filter((e) => e.action === 'auth.handoff.failed').map((e) => e.metadata?.reason),
    ).toEqual(['account', 'account', 'account']);
  });

  it('one person holds at most three live codes; a fourth retires their oldest', async () => {
    const { service, caller } = setup();
    const codes: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      codes.push((await service.issueHandoffCode(caller, challengeOf(VERIFIER), RETURN, ctx)).code);
    }
    await expect(service.exchangeHandoffCode(codes[0]!, VERIFIER, ctx)).rejects.toMatchObject({
      code: 'AUTH_HANDOFF_INVALID',
    });
    await expect(service.exchangeHandoffCode(codes[3]!, VERIFIER, ctx)).resolves.toBeDefined();
  });

  // AI-3b: whoever holds the code and its verifier gets a token for this person, so the code
  // goes to the AI web's configured callback and nowhere a link names.
  it('sends a code only to the configured AI web callback, and says where', async () => {
    const t = setup();
    const me = { sub: 'staff-1', role: Role.HEAD_OFFICE };
    await expect(t.service.issueHandoffCode(me, challengeOf(VERIFIER), RETURN, ctx)).resolves.toMatchObject({
      returnTo: RETURN,
      expiresIn: 60,
    });
    for (const elsewhere of [
      'https://evil.example/masuk/callback',
      `${RETURN}?x=1`,
      `${RETURN}/`,
      'https://ai.example.test/masuk/callback#a',
      'https://AI.example.test/masuk/callback',
      'http://ai.example.test/masuk/callback',
      '',
    ]) {
      await expect(t.service.issueHandoffCode(me, challengeOf(VERIFIER), elsewhere, ctx)).rejects.toMatchObject({
        code: 'AUTH_HANDOFF_RETURN_REFUSED',
      });
    }
  });

  it('refuses a customer before it looks at the address', async () => {
    const t = setup();
    await expect(
      t.service.issueHandoffCode({ sub: 'c-9', role: Role.CUSTOMER }, challengeOf(VERIFIER), 'https://evil.example/', ctx),
    ).rejects.toMatchObject({ code: 'AUTH_HANDOFF_STAFF_ONLY' });
  });

  it('accepts only a canonical https callback in the environment', () => {
    expect(aiWebReturnUrl('')).toBe('');
    expect(aiWebReturnUrl(RETURN)).toBe(RETURN);
    expect(aiWebReturnUrl('http://localhost:3000/masuk/callback')).toBe('http://localhost:3000/masuk/callback');
    for (const bad of [
      'http://ai.example.test/masuk/callback',
      'https://AI.example.test/masuk/callback',
      'https://user:pw@ai.example.test/masuk/callback',
      'https://ai.example.test/masuk/callback?x=1',
      'https://ai.example.test/masuk/callback#f',
      'not a url',
    ]) {
      expect(() => aiWebReturnUrl(bad)).toThrow(/AI_WEB_RETURN_URL/);
    }
  });

  it('issues no code at all while the AI web is not connected', async () => {
    const t = setup({ AI_WEB_RETURN_URL: '' });
    await expect(
      t.service.issueHandoffCode({ sub: 'staff-1', role: Role.HEAD_OFFICE }, challengeOf(VERIFIER), RETURN, ctx),
    ).rejects.toMatchObject({ code: 'AUTH_HANDOFF_RETURN_UNSET', status: 503 });
  });

  it('refuses customers, a full queue, and everything when switched off', async () => {
    const { service, caller, clock } = setup();
    await expect(
      service.issueHandoffCode({ sub: 'c1', role: Role.CUSTOMER }, challengeOf(VERIFIER), RETURN, ctx),
    ).rejects.toMatchObject({ code: 'AUTH_HANDOFF_STAFF_ONLY' });

    for (let i = 0; i < 1000; i += 1) {
      await service.issueHandoffCode({ ...caller, sub: `staff-${i}` }, challengeOf(VERIFIER), RETURN, ctx);
    }
    await expect(service.issueHandoffCode(caller, challengeOf(VERIFIER), RETURN, ctx)).rejects.toMatchObject({
      code: 'AUTH_HANDOFF_BUSY',
    });
    clock.advance(61); // expired codes are swept, which makes room again
    await expect(service.issueHandoffCode(caller, challengeOf(VERIFIER), RETURN, ctx)).resolves.toBeDefined();

    const off = setup({ AI_TOKEN_SIGNING_KEY: '' });
    await expect(off.service.issueHandoffCode(off.caller, challengeOf(VERIFIER), RETURN, ctx)).rejects.toMatchObject({
      code: 'AUTH_EXTERNAL_TOKENS_OFF',
    });
    await expect(off.service.exchangeHandoffCode('x', VERIFIER, ctx)).rejects.toMatchObject({
      code: 'AUTH_EXTERNAL_TOKENS_OFF',
    });
    await expect(off.service.issueMachineToken(ACCOUNT_ID, SECRET, ctx)).rejects.toMatchObject({
      code: 'AUTH_EXTERNAL_TOKENS_OFF',
    });
  });
});

describe('ExternalAccessService machine accounts', () => {
  it('trades id + secret for a machine token carrying exactly its scopes', async () => {
    const { service, signer, auditLog } = setup();
    const result = await service.issueMachineToken(ACCOUNT_ID, SECRET, ctx);
    expect(verifyExternalToken(result.accessToken, verifierKeys(signer), NOW.getTime())).toEqual({
      sub: ACCOUNT_ID,
      via: 'machine',
      role: null,
      depotId: null,
      scopes: ['hqConsole'],
    });
    expect(auditLog.entries[0]).toMatchObject({
      customerId: ACCOUNT_ID,
      action: 'auth.machine.token_issued',
      metadata: { name: 'n8n' },
    });
  });

  it('refuses a wrong secret, an unknown id and a secret past its day, saying which', async () => {
    const { service, clock, auditLog } = setup();
    await expect(service.issueMachineToken(ACCOUNT_ID, `${SECRET}x`, ctx)).rejects.toMatchObject({
      code: 'AUTH_MACHINE_INVALID',
    });
    await expect(
      service.issueMachineToken('00000000-0000-4000-8000-000000000000', SECRET, ctx),
    ).rejects.toMatchObject({ code: 'AUTH_MACHINE_INVALID' });
    clock.advance(31 * 86_400);
    await expect(service.issueMachineToken(ACCOUNT_ID, SECRET, ctx)).rejects.toMatchObject({
      code: 'AUTH_MACHINE_INVALID',
    });
    // The unknown id leaves no row: anyone can send one, and the trail is shared.
    expect(auditLog.entries.map((e) => [e.customerId, e.metadata?.reason])).toEqual([
      [ACCOUNT_ID, 'credentials'],
      [ACCOUNT_ID, 'expired'],
    ]);
  });
});

describe('ExternalAccessController', () => {
  it('passes each call through with the request context', async () => {
    const { service, signer, caller } = setup();
    const controller = new ExternalAccessController(service, signer);
    const req = { ip: '10.0.0.9', headers: { 'user-agent': 'n8n' } } as never;

    expect(controller.jwks().keys).toHaveLength(1);
    const { code } = await controller.handoffCode(
      caller as never,
      { codeChallenge: challengeOf(VERIFIER), codeChallengeMethod: 'S256', returnTo: RETURN },
      req,
    );
    await expect(controller.handoffToken({ code, codeVerifier: VERIFIER }, req)).resolves.toMatchObject({
      tokenType: 'Bearer',
    });
    await expect(
      controller.machineToken({ accountId: ACCOUNT_ID, secret: SECRET }, req),
    ).resolves.toMatchObject({ tokenType: 'Bearer' });
  });
});

describe('ExternalAccessService handoff second factor (HD-4)', () => {
  /** A HEAD_OFFICE account with its authenticator set up, 30 seconds after confirming it. */
  async function enrolled(env: Record<string, string> = {}) {
    const t = setup(env);
    const hq = makeCustomer({ role: Role.HEAD_OFFICE });
    t.customers.seed(hq);
    const me = { sub: hq.id, role: hq.role };
    const appCode = (): string => {
      const row = t.totpRepo.rows.get(hq.id)!;
      const secret = unsealSecret(t.config.totpKeys!.seal, row.secretSealed, hq.id);
      return hotp(secret, stepAt(t.clock.now().getTime()));
    };
    /** A code the app shows for none of the three steps that would be accepted now. */
    const wrongCode = (): string => {
      const row = t.totpRepo.rows.get(hq.id)!;
      const secret = unsealSecret(t.config.totpKeys!.seal, row.secretSealed, hq.id);
      const step = stepAt(t.clock.now().getTime());
      const live = [step - 1, step, step + 1].map((s) => hotp(secret, s));
      return ['000000', '111111', '222222', '333333'].find((c) => !live.includes(c))!;
    };
    await t.totp.startEnrolment(me, ctx);
    await t.totp.confirmEnrolment(me, appCode(), t.sms.lastCode!, ctx);
    t.clock.advance(30);
    const newCode = async () => (await t.service.issueHandoffCode(me, challengeOf(VERIFIER), RETURN, ctx)).code;
    return { ...t, hq, me, appCode, wrongCode, newCode };
  }

  it('a role that needs it but never set one up is told to, and the code is spent', async () => {
    const t = setup();
    const finance = makeCustomer({ role: Role.FINANCE });
    t.customers.seed(finance);
    const { code } = await t.service.issueHandoffCode(
      { sub: finance.id, role: finance.role },
      challengeOf(VERIFIER),
      RETURN,
      ctx,
    );
    await expect(t.service.exchangeHandoffCode(code, VERIFIER, ctx)).rejects.toMatchObject({
      code: 'AUTH_TOTP_ENROLMENT_REQUIRED',
    });
    await expect(
      t.service.exchangeHandoffCode(code, VERIFIER, ctx, { totp: '123456' }),
    ).rejects.toMatchObject({ code: 'AUTH_HANDOFF_INVALID' });
  });

  it('asks for the app code, keeps the code once for it, and returns a 12-hour ticket', async () => {
    const t = await enrolled();
    const code = await t.newCode();
    await expect(t.service.exchangeHandoffCode(code, VERIFIER, ctx)).rejects.toMatchObject({
      code: 'AUTH_TOTP_REQUIRED',
    });
    t.clock.advance(50); // past the code's first minute, inside the one it was given again
    const result = await t.service.exchangeHandoffCode(code, VERIFIER, ctx, { totp: t.appCode() });
    expect(result).toMatchObject({
      tokenType: 'Bearer',
      secondFactorTicketExpiresIn: SECOND_FACTOR_TICKET_TTL_SECONDS,
    });
    expect(result.secondFactorTicket).toEqual(expect.any(String));
    const exchanged = t.auditLog.entries.filter((e) => e.action === 'auth.handoff.exchanged');
    expect(exchanged.map((e) => e.metadata)).toEqual([{ secondFactor: 'totp' }]);

    // The next handoff sends the ticket instead of a code, and gets no new ticket.
    const again = await t.service.exchangeHandoffCode(await t.newCode(), VERIFIER, ctx, {
      ticket: result.secondFactorTicket,
    });
    expect(again.secondFactorTicket).toBeUndefined();
  });

  it('keeps a code only once, and only for 60 seconds more', async () => {
    const t = await enrolled();
    const code = await t.newCode();
    const missing = { code: 'AUTH_TOTP_REQUIRED' };
    await expect(t.service.exchangeHandoffCode(code, VERIFIER, ctx)).rejects.toMatchObject(missing);
    await expect(t.service.exchangeHandoffCode(code, VERIFIER, ctx)).rejects.toMatchObject(missing);
    await expect(
      t.service.exchangeHandoffCode(code, VERIFIER, ctx, { totp: t.appCode() }),
    ).rejects.toMatchObject({ code: 'AUTH_HANDOFF_INVALID' });

    const late = await t.newCode();
    await expect(t.service.exchangeHandoffCode(late, VERIFIER, ctx)).rejects.toMatchObject(missing);
    t.clock.advance(61);
    await expect(
      t.service.exchangeHandoffCode(late, VERIFIER, ctx, { totp: t.appCode() }),
    ).rejects.toMatchObject({ code: 'AUTH_HANDOFF_INVALID' });
  });

  it('a wrong app code spends the code; a wrong verifier never reaches the second factor', async () => {
    const t = await enrolled();
    const code = await t.newCode();
    await expect(
      t.service.exchangeHandoffCode(code, VERIFIER, ctx, { totp: t.wrongCode() }),
    ).rejects.toMatchObject({ code: 'AUTH_TOTP_INVALID' });
    await expect(
      t.service.exchangeHandoffCode(code, VERIFIER, ctx, { totp: t.appCode() }),
    ).rejects.toMatchObject({ code: 'AUTH_HANDOFF_INVALID' });

    const other = await t.newCode();
    await expect(t.service.exchangeHandoffCode(other, 'w'.repeat(43), ctx)).rejects.toMatchObject({
      code: 'AUTH_HANDOFF_INVALID',
    });
    expect(t.auditLog.entries.filter((e) => e.action === 'auth.totp.failed')).toHaveLength(1);
  });

  it('with no TOTP_ENCRYPTION_KEY a role that needs it cannot sign in at all', async () => {
    const t = setup({ TOTP_ENCRYPTION_KEY: '' });
    const director = makeCustomer({ role: Role.DIREKTUR });
    t.customers.seed(director);
    const { code } = await t.service.issueHandoffCode(
      { sub: director.id, role: director.role },
      challengeOf(VERIFIER),
      RETURN,
      ctx,
    );
    await expect(t.service.exchangeHandoffCode(code, VERIFIER, ctx)).rejects.toMatchObject({
      code: 'AUTH_TOTP_OFF',
    });
  });

  it('the controller passes the second factor through', async () => {
    const t = await enrolled();
    const controller = new ExternalAccessController(t.service, t.signer);
    const req = { ip: '10.0.0.9', headers: { 'user-agent': 'ai-web' } } as never;
    const code = await t.newCode();
    await expect(
      controller.handoffToken({ code, codeVerifier: VERIFIER, totp: t.appCode() }, req),
    ).resolves.toMatchObject({ secondFactorTicketExpiresIn: SECOND_FACTOR_TICKET_TTL_SECONDS });
  });
});
