/**
 * Bucket lifecycle rules, merged rather than replaced.
 *
 * `PutBucketLifecycleConfiguration` REPLACES the bucket's whole rule set. Three scripts each
 * wrote "their" rule with it — s3-prune (30-day noncurrent expiry on the backup bucket),
 * verify-object-storage (the 12-month pod/ rule), and now the evidence retention below — so
 * whichever ran last silently deleted the others' rules. s3-prune runs from two nightly cron
 * jobs on the backup bucket, which means any rule added there by another script would have
 * been wiped within a day, and nothing would have said so.
 *
 * Everything that sets a rule goes through `applyRules` now: rules with the SAME ID are
 * replaced, every other rule is left exactly as it was.
 */
import {
  GetBucketLifecycleConfigurationCommand,
  PutBucketLifecycleConfigurationCommand,
} from '@aws-sdk/client-s3';

/**
 * The evidence prefixes and the window the privacy policy promises for them.
 *
 * `pod/` (proof-of-delivery photo and signature) and `payment-proof/` (a customer's transfer
 * receipt) are both kept 12 months — the `proof_of_delivery` and `payment_proof` rows of
 * retention_policies in admin-service. Change one of them there and change it here.
 *
 * The backup copy lives one month longer (owner decision 2026-09-25): the source is deleted
 * on the policy's day, and a backup that outlives it by a bounded margin is still a promise
 * that can be kept, where "never deleted" is not.
 */
export const EVIDENCE_PREFIXES = ['pod/', 'payment-proof/'];
export const EVIDENCE_DAYS = 365;
export const EVIDENCE_BACKUP_DAYS = 395;
export const NONCURRENT_DAYS = 30;

/** One rule per prefix: the current object expires after `days`, old versions 30 days after. */
export function evidenceRules({ prefixes, days, idPrefix, noncurrentDays = NONCURRENT_DAYS }) {
  return prefixes.map((prefix) => ({
    ID: `${idPrefix}-${prefix.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '')}`,
    Status: 'Enabled',
    Filter: { Prefix: prefix },
    Expiration: { Days: days },
    NoncurrentVersionExpiration: { NoncurrentDays: noncurrentDays },
  }));
}

/**
 * Rules with one of `ours`' IDs are replaced; all others are kept in their original order.
 * `retire` names rules an earlier version of some script wrote under another ID, so a rename
 * does not leave two rules covering the same prefix.
 */
export function mergeRules(existing, ours, retire = []) {
  const drop = new Set([...ours.map((rule) => rule.ID), ...retire]);
  return [...existing.filter((rule) => !drop.has(rule.ID)), ...ours];
}

const stable = (value) =>
  JSON.stringify(value, (_k, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );

/** True when every one of `ours` is present, identically, and nothing to retire remains. */
export function alreadyApplied(existing, ours, retire = []) {
  return (
    ours.every((rule) => {
      const have = existing.find((r) => r.ID === rule.ID);
      return have !== undefined && stable(have) === stable(rule);
    }) && !existing.some((rule) => retire.includes(rule.ID))
  );
}

/** The bucket's rules. A bucket with no lifecycle configuration at all is an empty set. */
export async function readRules(client, bucket) {
  try {
    const current = await client.send(
      new GetBucketLifecycleConfigurationCommand({ Bucket: bucket }),
    );
    return current.Rules ?? [];
  } catch (error) {
    if (error?.name === 'NoSuchLifecycleConfiguration') return [];
    throw error;
  }
}

/**
 * Merge `ours` into the bucket's rules and write them back only if something changed.
 * `dryRun` reads and reports but never writes: the diagnostic can then say whether the rules
 * are really there instead of promising that they would be.
 */
export async function applyRules(client, bucket, ours, { retire = [], dryRun = false } = {}) {
  const existing = await readRules(client, bucket);
  if (alreadyApplied(existing, ours, retire)) return 'already set';
  if (dryRun) return 'NOT set yet (dry run)';
  const rules = mergeRules(existing, ours, retire);
  await client.send(
    new PutBucketLifecycleConfigurationCommand({
      Bucket: bucket,
      LifecycleConfiguration: { Rules: rules },
    }),
  );
  return `set (${rules.length} rule(s) in total)`;
}
