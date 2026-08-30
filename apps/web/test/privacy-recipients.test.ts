import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * A third party that receives customer data must be NAMED in the privacy policy — and the
 * policy says "inilah daftar lengkapnya" / "the complete list", so an unnamed one makes that
 * sentence false rather than merely incomplete.
 *
 * This is not hypothetical. Sentry was wired into the app weeks ago and left out of the policy
 * on the reasoning that the DSN was empty, so nothing was actually being sent. That reasoning
 * held right up to the moment somebody set `SENTRY_DSN_MOBILE` — an ops action, in a settings
 * page, that has no idea a legal document depends on it. The policy went stale the instant the
 * variable was created and nothing anywhere would have said so.
 *
 * So the gate is not "is Sentry mentioned" (it is now) but "does every outbound integration in
 * the codebase appear in both policies". The next one gets caught on the day it lands, not on
 * the day somebody fills in its credential.
 */
const repo = join(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(repo, p), 'utf8');

const POLICIES = ['apps/web/src/lib/dictionaries/id/privacy.ts', 'apps/web/src/lib/dictionaries/en/privacy.ts'];

/*
 * Each entry: the recipient's name as a customer would read it, and a marker proving the
 * integration is really in the tree. The marker is what makes this a measurement rather than a
 * list somebody has to remember to update — remove the integration and the row retires itself.
 */
const RECIPIENTS: { name: string; provenBy: { file: string; needle: string } }[] = [
  { name: 'Sentry', provenBy: { file: 'apps/web/src/components/sentry-init.tsx', needle: '@sentry/nextjs' } },
  { name: 'Zenziva', provenBy: { file: 'services/auth-service/src/config/env.validation.ts', needle: 'zenziva' } },
  { name: 'BiznetGio', provenBy: { file: 'scripts/backup-offsite.sh', needle: 'nos.jkt-1.neo.id' } },
];

describe('every third party that receives customer data is named in both policies', () => {
  for (const { name, provenBy } of RECIPIENTS) {
    it(`${name} is in the codebase, and in the policy`, () => {
      // First prove the integration exists — otherwise this test would demand a policy entry
      // for something nobody uses any more.
      expect(read(provenBy.file)).toContain(provenBy.needle);
      for (const policy of POLICIES) {
        expect(read(policy)).toContain(name);
      }
    });
  }

  it('and Firebase Cloud Messaging, which reaches Android devices', () => {
    // Named separately: the customer reads "Google", the code says FCM.
    const adapter = 'services/crm-service/src/infrastructure/fcm/fcm.sender.adapter.ts';
    expect(read(adapter)).toContain('fcm');
    for (const policy of POLICIES) {
      expect(read(policy)).toContain('Google');
      expect(read(policy)).toContain('Firebase');
    }
  });
});
