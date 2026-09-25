#!/usr/bin/env bash
# The nightly copy to a SECOND provider: the newest database dump and the evidence bucket,
# through the same scripts that feed the first (backup-offsite.sh, backup-objects.mjs).
#
#   cd $REPO && . ./scripts/load-env.sh && bash scripts/backup-second-provider.sh
#
# Why it exists. Every copy of this system — the box, its databases, the object bucket, the
# "offsite" backup — lives with ONE provider. An account suspension, a billing lapse or a regional
# failure there takes all of them at once, and moving to another VPS is only a recovery if the data
# does not go down with the old one. Two copies on the same provider are one copy.
#
# Configured in .env, next to the primary's BACKUP_* (S3-compatible: Cloudflare R2, Backblaze B2,
# Wasabi, any other):
#
#   BACKUP2_OFFSITE_DEST=s3://<bucket>[/prefix]
#   BACKUP2_S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com
#   BACKUP2_S3_REGION=auto                       (default auto)
#   BACKUP2_S3_ACCESS_KEY_ID= / BACKUP2_S3_SECRET_ACCESS_KEY=
#
# Unset BACKUP2_OFFSITE_DEST is a deliberate "one provider" and exits 0 with a sentence saying so.
# Set but incomplete, or pointing at the SAME host as the primary, exits 2: a second copy that quietly
# lands on the first provider is worse than none, because every check would call it done.
# Exit 1 when either copy failed. Both are attempted; one failing does not skip the other.
set -uo pipefail

cd "$(dirname "$0")/.."
# shellcheck source=scripts/lib/second-provider.sh
. ./scripts/lib/second-provider.sh

if [ -z "${BACKUP2_OFFSITE_DEST:-}" ]; then
  echo "BACKUP2_OFFSITE_DEST is not set — one provider only (see the header of this script)"
  exit 0
fi

missing="$(second_provider_missing)"
if [ -n "$missing" ]; then
  echo "!! second backup provider is half-configured; missing: $missing" >&2
  exit 2
fi
if second_provider_is_primary; then
  echo "!! BACKUP2_S3_ENDPOINT is the same host as the primary (${BACKUP_S3_ENDPOINT:-https://nos.jkt-1.neo.id})." >&2
  echo "   Two copies on one provider are one copy; choose a different provider." >&2
  exit 2
fi

rc=0
echo "== second provider: database dump"
( second_provider_env; bash scripts/backup-offsite.sh ) || rc=1
echo "== second provider: evidence bucket"
( second_provider_env; node scripts/backup-objects.mjs ) || rc=1
exit "$rc"
