import { createHash, createPrivateKey, createPublicKey, type KeyObject } from 'node:crypto';

import { CAPABILITIES } from '@hydromart/access';

/**
 * HD-3: the two settings behind AI-web and machine tokens, parsed once at boot (env
 * validation) and again where they are used, so a value that boots is a value that works.
 *
 *   AI_TOKEN_SIGNING_KEY   base64 of a PKCS8 DER P-256 private key. Blank = the switch is
 *                          off: the JWKS is empty, so every service drops every AI and
 *                          machine token within a minute, and nothing new is signed.
 *   MACHINE_ACCOUNTS       a JSON list of machine accounts (n8n). See parseMachineAccounts.
 *
 * Make a key: openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -outform DER | base64 -w0
 */

/** A P-256 private key from its base64 PKCS8 DER form. Throws on anything else. */
export function parseSigningKey(base64: string): KeyObject {
  const key = createPrivateKey({ key: Buffer.from(base64, 'base64'), format: 'der', type: 'pkcs8' });
  if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
    throw new Error('the key is not an EC P-256 private key');
  }
  return key;
}

export interface PublicJwk {
  kty: 'EC';
  crv: 'P-256';
  x: string;
  y: string;
  kid: string;
  use: 'sig';
  alg: 'ES256';
}

/** The public half as a JWK, its `kid` the RFC 7638 thumbprint, so it names the key itself. */
export function publicJwk(privateKey: KeyObject): PublicJwk {
  const { x, y } = createPublicKey(privateKey).export({ format: 'jwk' }) as { x: string; y: string };
  const kid = createHash('sha256')
    .update(`{"crv":"P-256","kty":"EC","x":"${x}","y":"${y}"}`)
    .digest('base64url');
  return { kty: 'EC', crv: 'P-256', x, y, kid, use: 'sig', alg: 'ES256' };
}

/** A machine secret lives at most this long: rotated every 90 days (Plan Eksekusi section 4). */
export const MACHINE_SECRET_MAX_DAYS = 90;
const DAY_MS = 86_400_000;

export interface MachineAccount {
  /** A UUID: it is the token's `sub`, and the audit trail stores actors as UUIDs. */
  id: string;
  /** Who it is, for people reading the trail: `n8n`. */
  name: string;
  /** sha256 (hex) of the secret. The secret itself is only in the machine's own store. */
  secretSha256: string;
  /** The closed capability list the token carries. Every entry is a real capability. */
  scopes: string[];
  /** The day this secret stops working. At most 90 days ahead. */
  notAfter: Date;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NAME = /^[a-z0-9-]{1,40}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * `[{"id":"<uuid>","name":"n8n","secretSha256":"<hex>","scopes":["<capability>"],
 *    "notAfter":"2027-02-19"}]`. One id may appear twice with two secrets while a rotation
 * is under way. Throws on the first thing wrong, naming it; blank is no accounts.
 */
export function parseMachineAccounts(raw: string, now: Date = new Date()): MachineAccount[] {
  if (!raw.trim()) return [];
  const list: unknown = JSON.parse(raw);
  if (!Array.isArray(list)) throw new Error('MACHINE_ACCOUNTS must be a JSON list');
  return list.map((entry: unknown, i): MachineAccount => {
    const e = (entry ?? {}) as Record<string, unknown>;
    const at = `MACHINE_ACCOUNTS[${i}]`;
    if (typeof e.id !== 'string' || !UUID.test(e.id)) throw new Error(`${at}.id must be a UUID`);
    if (typeof e.name !== 'string' || !NAME.test(e.name)) {
      throw new Error(`${at}.name must be lowercase letters, digits or dashes`);
    }
    if (typeof e.secretSha256 !== 'string' || !SHA256_HEX.test(e.secretSha256)) {
      throw new Error(`${at}.secretSha256 must be 64 lowercase hex characters`);
    }
    if (!Array.isArray(e.scopes) || e.scopes.length === 0) {
      throw new Error(`${at}.scopes must list at least one capability`);
    }
    for (const scope of e.scopes) {
      if (typeof scope !== 'string' || !Object.hasOwn(CAPABILITIES, scope)) {
        throw new Error(`${at}.scopes: "${String(scope)}" is not a capability`);
      }
    }
    const notAfter = new Date(typeof e.notAfter === 'string' ? e.notAfter : Number.NaN);
    if (Number.isNaN(notAfter.getTime())) throw new Error(`${at}.notAfter must be an ISO date`);
    if (notAfter.getTime() - now.getTime() > MACHINE_SECRET_MAX_DAYS * DAY_MS) {
      throw new Error(`${at}.notAfter is more than ${MACHINE_SECRET_MAX_DAYS} days ahead`);
    }
    return { id: e.id, name: e.name, secretSha256: e.secretSha256, scopes: [...e.scopes], notAfter };
  });
}

/** True while a secret may be used: not yet past its day, and never more than 90 days out. */
export function machineSecretLive(account: MachineAccount, now: Date): boolean {
  const left = account.notAfter.getTime() - now.getTime();
  return left > 0 && left <= MACHINE_SECRET_MAX_DAYS * DAY_MS;
}
