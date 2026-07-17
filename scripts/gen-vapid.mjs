#!/usr/bin/env node
// Generate a VAPID keypair for Web Push (design 7b) — no dependency, pure Node crypto.
// Output is identical in format to `web-push generateVAPIDKeys()`:
//   public  = base64url of the uncompressed P-256 point (0x04 || x || y)
//   private = base64url of the 32-byte private scalar (JWK `d`)
// Paste the two keys into your .env (keep the private key secret, never commit it).
import { generateKeyPairSync } from 'node:crypto';

const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pub = publicKey.export({ format: 'jwk' });
const priv = privateKey.export({ format: 'jwk' });

const b64url = (s) => Buffer.from(s, 'base64url');
const publicB64 = Buffer.concat([Buffer.from([4]), b64url(pub.x), b64url(pub.y)]).toString('base64url');
const privateB64 = b64url(priv.d).toString('base64url');

console.log(`VAPID_PUBLIC_KEY=${publicB64}`);
console.log(`VAPID_PRIVATE_KEY=${privateB64}`);
console.log('VAPID_SUBJECT=mailto:ops@hydromart.id');
