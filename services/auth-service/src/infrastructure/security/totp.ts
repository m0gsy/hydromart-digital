import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/**
 * HD-4: the arithmetic behind the authenticator (TOTP) step of the AI-web sign-in. Pure
 * functions over node:crypto, no library: RFC 4226 / 6238 with the parameters every
 * authenticator app uses (SHA-1, 6 digits, 30-second steps).
 */

export const TOTP_STEP_SECONDS = 30;
const DIGITS = 6;
/** One step either side of now: a phone clock a little off still works (RFC 6238 section 5.2). */
const DRIFT_STEPS = 1;
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
/** A 32-byte key in base64 is exactly 44 characters ending in one `=`. */
const KEY_BASE64 = /^[A-Za-z0-9+/]{43}=$/;

/** TOTP_ENCRYPTION_KEY: 32 random bytes as base64 (`openssl rand -base64 32`). Throws otherwise. */
export function parseTotpKey(base64: string): Buffer {
  if (!KEY_BASE64.test(base64)) throw new Error('TOTP_ENCRYPTION_KEY must be 32 bytes, base64');
  return Buffer.from(base64, 'base64');
}

export interface TotpKeys {
  /** Seals the shared secrets (AES-256-GCM). */
  seal: Buffer;
  /** Keys the recovery-code hashes and the second-factor tickets (HMAC-SHA256). */
  mac: Buffer;
}

/** Two independent keys from the one setting, so no key does two jobs. */
export function totpKeys(master: Buffer): TotpKeys {
  const derive = (info: string): Buffer =>
    Buffer.from(hkdfSync('sha256', master, Buffer.alloc(0), info, 32));
  return { seal: derive('hydromart-totp-seal-v1'), mac: derive('hydromart-totp-mac-v1') };
}

/** RFC 4648 base32 without padding: how the secret is written into the otpauth:// link. */
export function base32(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    // At most 12 bits are ever pending (4 left over + 8 new), so 0xfff keeps them all.
    value = ((value << 8) | byte) & 0xfff;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

/** RFC 4226 HOTP for one counter value: the 6-digit code an authenticator app shows. */
export function hotp(secret: Buffer, counter: number): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', secret).update(message).digest();
  const offset = mac[mac.length - 1]! & 0xf;
  return ((mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITS).toString().padStart(DIGITS, '0');
}

/** The 30-second step a moment falls in. */
export const stepAt = (nowMs: number): number => Math.floor(nowMs / 1000 / TOTP_STEP_SECONDS);

/**
 * The step `code` belongs to, when it is within one step of now and newer than `afterStep`
 * (the last step accepted, so a code is never accepted twice). Null when it matches none.
 */
export function matchStep(
  secret: Buffer,
  code: string,
  nowMs: number,
  afterStep: number | null,
): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const now = stepAt(nowMs);
  for (let step = now - DRIFT_STEPS; step <= now + DRIFT_STEPS; step += 1) {
    if (afterStep !== null && step <= afterStep) continue;
    if (timingSafeEqual(Buffer.from(hotp(secret, step)), Buffer.from(code))) return step;
  }
  return null;
}

/*
 * The account id is the GCM additional data: a sealed secret copied onto another account's
 * row fails to open there, so a database write alone cannot hand one person's authenticator
 * to somebody else's account.
 */

/** GCM's full 128-bit tag, written and required. */
const TAG_BYTES = 16;

/** `v1.<iv>.<tag>.<ciphertext>`, AES-256-GCM, bound to the account it belongs to. */
export function sealSecret(key: Buffer, secret: Buffer, customerId: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES }).setAAD(
    Buffer.from(customerId),
  );
  const body = Buffer.concat([cipher.update(secret), cipher.final()]);
  const parts = [iv, cipher.getAuthTag(), body].map((part) => part.toString('base64url'));
  return ['v1', ...parts].join('.');
}

/** The secret back, or a throw when the value was altered, moved, or sealed with another key. */
export function unsealSecret(key: Buffer, sealed: string, customerId: string): Buffer {
  const [version, iv, tag, body, extra] = sealed.split('.');
  if (version !== 'v1' || !iv || !tag || !body || extra !== undefined) {
    throw new Error('not a sealed TOTP secret');
  }
  // The tag length is pinned: GCM would otherwise accept a tag cut down to 4 bytes, which a
  // forger can hit by trying.
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'), {
    authTagLength: TAG_BYTES,
  })
    .setAAD(Buffer.from(customerId))
    .setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]);
}

/** How many recovery codes an enrolment hands out, each usable once. */
export const RECOVERY_CODE_COUNT = 10;

/** Ten codes of ten base32 characters (50 random bits each), written XXXXX-XXXXX. */
export function newRecoveryCodes(): string[] {
  return Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    // 7 bytes give 12 characters; the first 10 carry 50 uniform bits.
    const raw = base32(randomBytes(7)).slice(0, 10);
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}

/**
 * Keyed, so a copy of the table cannot be searched offline: 50 bits behind a plain hash
 * would fall to one graphics card in about a day.
 */
export function recoveryCodeHash(macKey: Buffer, code: string): string {
  const normalised = code.toUpperCase().replace(/[\s-]/g, '');
  return createHmac('sha256', macKey).update(`recovery|${normalised}`).digest('hex');
}

const ticketMac = (macKey: Buffer, customerId: string, enrolment: string, exp: number): string =>
  createHmac('sha256', macKey).update(`ticket|${customerId}|${enrolment}|${exp}`).digest('base64url');

/**
 * `<exp>.<mac>`: proof that this person passed the authenticator step, good until `exp`
 * (Unix seconds). Bound to the enrolment (its sealed secret, new and random every time), so
 * a reset or a new enrolment voids every ticket.
 */
export function signTicket(macKey: Buffer, customerId: string, enrolment: string, exp: number): string {
  return `${exp}.${ticketMac(macKey, customerId, enrolment, exp)}`;
}

/** True for a ticket this key signed for this enrolment that has not run out. */
export function ticketValid(
  macKey: Buffer,
  ticket: string,
  customerId: string,
  enrolment: string,
  nowMs: number,
  maxTtlSeconds: number,
): boolean {
  const [expText, mac, extra] = ticket.split('.');
  const exp = Number(expText);
  if (!mac || extra !== undefined || !Number.isSafeInteger(exp)) return false;
  const left = exp - nowMs / 1000;
  if (left <= 0 || left > maxTtlSeconds) return false;
  const expected = Buffer.from(ticketMac(macKey, customerId, enrolment, exp));
  const given = Buffer.from(mac);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
