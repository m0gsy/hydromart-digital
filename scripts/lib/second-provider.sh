#!/usr/bin/env bash
# Shared by scripts/backup-second-provider.sh and scripts/check-backup-freshness.sh.
#
# The offsite scripts read ONE set of names (BACKUP_OFFSITE_DEST, BACKUP_S3_*). A second provider is
# the same scripts pointed at a different bucket, so instead of forking them it is a second set of
# names (BACKUP2_*) that is mapped onto the first inside a subshell, for one command:
#
#   ( second_provider_env; bash scripts/backup-offsite.sh )
#
# Source it; it defines functions only.

# Why not fall back to the primary's endpoint when BACKUP2_S3_ENDPOINT is empty: backup-offsite.sh
# defaults an unset endpoint to NEO, the PRIMARY provider — so a forgotten line would quietly write
# the "second" copy to the same provider and every check would pass.
second_provider_missing() {
  local k out=""
  for k in BACKUP2_OFFSITE_DEST BACKUP2_S3_ENDPOINT BACKUP2_S3_ACCESS_KEY_ID BACKUP2_S3_SECRET_ACCESS_KEY; do
    [ -z "${!k:-}" ] && out="$out $k"
  done
  printf '%s' "${out# }"
}

# The two providers must be two providers. Compared by host so a trailing slash or a scheme does
# not hide that they are the same one.
second_provider_is_primary() {
  local a b
  a="$(printf '%s' "${BACKUP2_S3_ENDPOINT:-}" | sed -E 's#^[a-z]+://##; s#/.*$##')"
  b="$(printf '%s' "${BACKUP_S3_ENDPOINT:-https://nos.jkt-1.neo.id}" | sed -E 's#^[a-z]+://##; s#/.*$##')"
  [ -n "$a" ] && [ "$a" = "$b" ]
}

# Point the BACKUP_* names at the second provider for the rest of THIS shell — call it inside ( ).
second_provider_env() {
  export BACKUP_OFFSITE_DEST="$BACKUP2_OFFSITE_DEST"
  export BACKUP_S3_ENDPOINT="$BACKUP2_S3_ENDPOINT"
  export BACKUP_S3_REGION="${BACKUP2_S3_REGION:-auto}"
  export BACKUP_S3_ACCESS_KEY_ID="$BACKUP2_S3_ACCESS_KEY_ID"
  export BACKUP_S3_SECRET_ACCESS_KEY="$BACKUP2_S3_SECRET_ACCESS_KEY"
  # A key that cannot delete (the point of a ransomware-resistant second copy) cannot prune either;
  # the provider's own lifecycle rule does that. BACKUP2_NO_DELETE=1 says so, so the nightly log is
  # not a standing "prune failed".
  export BACKUP_SKIP_PRUNE="${BACKUP2_NO_DELETE:-}"
}
