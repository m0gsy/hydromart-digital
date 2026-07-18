import { execSync } from 'node:child_process';

// The dev/test stack delivers OTPs to the auth-service log (console adapter), never
// to a client-readable surface — in prod they go to SMS and the DB stores only a hash.
// So the E2E reads the code back from the container log. This is deliberately a
// test-tier concern: it adds NO backend surface that could leak codes in production.
//
// Override the log command per environment:
//   E2E_OTP_LOG_CMD   full command whose stdout is the auth log (wins if set)
//   E2E_AUTH_CONTAINER container name for `docker logs` (default hydromart-auth-1)
// CI (compose-managed) sets E2E_OTP_LOG_CMD='docker compose logs --no-color auth'.
function logCmd(): string {
  if (process.env.E2E_OTP_LOG_CMD) return process.env.E2E_OTP_LOG_CMD;
  return `docker logs ${process.env.E2E_AUTH_CONTAINER ?? 'hydromart-auth-1'}`;
}

/** Normalise the login-form phone (e.g. "81100000001") to the E.164 form the log prints. */
export function e164(phone: string): string {
  const t = phone.replace(/[\s-]/g, '');
  if (t.startsWith('+')) return t;
  if (t.startsWith('62')) return `+${t}`;
  if (t.startsWith('0')) return `+62${t.slice(1)}`;
  return `+62${t}`;
}

/**
 * Read the most recent OTP the auth service logged for a phone. Polls briefly because
 * the log line lands just after the /otp/request round-trip returns to the browser.
 * Line format: `[DEV OTP] LOGIN code for +6281100000001: 123456 (valid 300s)`.
 */
export async function readLatestOtp(phone: string, purpose = 'LOGIN'): Promise<string> {
  const target = e164(phone);
  // Anchor on the exact phone + purpose so a concurrent test's code can't be picked up.
  const re = new RegExp(`\\[DEV OTP\\]\\s+${purpose}\\s+code for ${escapeRe(target)}:\\s*(\\d{4,8})`, 'g');

  for (let attempt = 0; attempt < 10; attempt++) {
    const out = safeExec(logCmd());
    let last: string | undefined;
    for (const m of out.matchAll(re)) last = m[1]; // newest wins
    if (last) return last;
    await sleep(500);
  }
  throw new Error(`No OTP found in auth log for ${target} (${purpose}). Is the console OTP channel active?`);
}

function safeExec(cmd: string): string {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 });
  } catch (e: any) {
    // `docker logs` writes app output to stderr; a non-zero exit still carries it.
    return `${e?.stdout ?? ''}${e?.stderr ?? ''}`;
  }
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
