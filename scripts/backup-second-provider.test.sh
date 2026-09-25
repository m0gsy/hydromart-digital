#!/usr/bin/env bash
# The runnable check for scripts/backup-second-provider.sh and scripts/lib/second-provider.sh.
#
#   bash scripts/backup-second-provider.test.sh
#
# The wrapper decides WHERE a copy of every database and every proof photo goes. Its worst failure
# is a silent one: a "second" copy that lands on the first provider, or on none, while every check
# reads green. So the offsite and object scripts are replaced by stand-ins that record what they
# were handed, and the refusals and the mapping are asserted here.
set -uo pipefail
# CI invokes this as `bash -e file`; assertions below drive commands that exit non-zero on purpose.
set +e
cd "$(dirname "$0")/.."
ROOT="$PWD"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

fails=0
ok() { echo "  ok   $1"; }
bad() {
  echo "  FAIL $1"
  fails=$((fails + 1))
}

# A repo-shaped copy: the wrapper and its helper are the real ones; the two scripts it calls are not.
mkdir -p "$WORK/repo/scripts/lib" "$WORK/bin"
cp scripts/backup-second-provider.sh "$WORK/repo/scripts/"
cp scripts/lib/second-provider.sh "$WORK/repo/scripts/lib/"
cat > "$WORK/repo/scripts/backup-offsite.sh" <<'SH'
#!/usr/bin/env bash
echo "offsite dest=$BACKUP_OFFSITE_DEST endpoint=$BACKUP_S3_ENDPOINT region=$BACKUP_S3_REGION key=$BACKUP_S3_ACCESS_KEY_ID secret=$BACKUP_S3_SECRET_ACCESS_KEY" >> "$CALLS"
printf '%s' "${BACKUP_SKIP_PRUNE:-}" > "$CALLS.skip"
[ "${FAIL_DUMP:-}" = 1 ] && exit 1
exit 0
SH
cat > "$WORK/bin/node" <<'SH'
#!/usr/bin/env bash
echo "objects dest=$BACKUP_OFFSITE_DEST endpoint=$BACKUP_S3_ENDPOINT key=$BACKUP_S3_ACCESS_KEY_ID" >> "$CALLS"
exit 0
SH
chmod +x "$WORK/repo/scripts/backup-offsite.sh" "$WORK/bin/node"
export PATH="$WORK/bin:$PATH" CALLS="$WORK/calls"

reset() {
  rm -f "$CALLS"
  unset BACKUP2_OFFSITE_DEST BACKUP2_S3_ENDPOINT BACKUP2_S3_REGION BACKUP2_S3_ACCESS_KEY_ID BACKUP2_S3_SECRET_ACCESS_KEY FAIL_DUMP
  export BACKUP_S3_ENDPOINT="https://nos.jkt-1.neo.id" BACKUP_S3_ACCESS_KEY_ID=PRIMARYKEY BACKUP_S3_SECRET_ACCESS_KEY=PRIMARYSECRET
}
configure() {
  export BACKUP2_OFFSITE_DEST=s3://second-bucket/db BACKUP2_S3_ENDPOINT=https://acct.r2.cloudflarestorage.com
  export BACKUP2_S3_ACCESS_KEY_ID=SECONDKEY BACKUP2_S3_SECRET_ACCESS_KEY=SECONDSECRET
}
run() { bash "$WORK/repo/scripts/backup-second-provider.sh" > "$WORK/out" 2>&1; RC=$?; }
calls() { [ -f "$CALLS" ] && wc -l < "$CALLS" | tr -d ' ' || echo 0; }

echo "second backup provider:"

reset
run
[ "$RC" = 0 ] && [ "$(calls)" = 0 ] && grep -q 'one provider only' "$WORK/out" && ok "unset: a deliberate one-provider setup exits 0, says so, copies nothing" || bad "unset must be a quiet exit 0 (rc=$RC)"

reset; configure; unset BACKUP2_S3_ENDPOINT
run
[ "$RC" = 2 ] && [ "$(calls)" = 0 ] && grep -q 'BACKUP2_S3_ENDPOINT' "$WORK/out" && ok "half-configured (no endpoint): exit 2, names the missing variable, copies nothing" || bad "a missing endpoint must refuse (rc=$RC): $(cat "$WORK/out")"

reset; configure; unset BACKUP2_S3_SECRET_ACCESS_KEY
run
[ "$RC" = 2 ] && [ "$(calls)" = 0 ] && ok "half-configured (no secret): exit 2, copies nothing" || bad "a missing secret must refuse (rc=$RC)"

reset; configure; export BACKUP2_S3_ENDPOINT="https://nos.jkt-1.neo.id/"
run
[ "$RC" = 2 ] && [ "$(calls)" = 0 ] && grep -q 'same host as the primary' "$WORK/out" && ok "endpoint is the primary's host: refused (two copies on one provider are one copy)" || bad "the same provider must be refused (rc=$RC)"

reset; configure; export BACKUP_S3_ENDPOINT="https://acct.r2.cloudflarestorage.com"
run
[ "$RC" = 2 ] && [ "$(calls)" = 0 ] && ok "same host as an explicitly configured primary: refused too" || bad "an explicit primary endpoint must be compared as well (rc=$RC)"

reset; configure
run
[ "$RC" = 0 ] && [ "$(calls)" = 2 ] && ok "configured: exit 0, the dump and the objects are each copied once" || bad "the happy path should make two calls (rc=$RC, calls=$(calls))"
grep -q '^offsite dest=s3://second-bucket/db endpoint=https://acct.r2.cloudflarestorage.com region=auto key=SECONDKEY secret=SECONDSECRET$' "$CALLS" &&
  ok "the dump script is handed the SECOND provider's destination, endpoint, region and keys" || bad "the dump copy got the wrong provider: $(head -1 "$CALLS")"
grep -q '^objects dest=s3://second-bucket/db endpoint=https://acct.r2.cloudflarestorage.com key=SECONDKEY$' "$CALLS" &&
  ok "the objects script is handed the second provider too" || bad "the objects copy got the wrong provider: $(tail -1 "$CALLS")"
grep -q 'PRIMARY' "$CALLS" && bad "the primary's credentials leaked into the second copy" || ok "the primary's credentials never reach the second copy"
[ "$(cat "$CALLS.skip")" = "" ] && ok "by default the second copy prunes like the first (BACKUP_SKIP_PRUNE unset)" || bad "prune must stay on by default: '$(cat "$CALLS.skip")'"

# A key that cannot delete (the ransomware-resistant setup) must not turn the nightly log into a
# standing "prune failed": BACKUP2_NO_DELETE=1 tells the offsite script to leave pruning to the
# provider's own lifecycle rule.
reset; configure; export BACKUP2_NO_DELETE=1
run
[ "$RC" = 0 ] && [ "$(cat "$CALLS.skip")" = 1 ] && ok "BACKUP2_NO_DELETE=1 reaches the offsite script as BACKUP_SKIP_PRUNE=1" || bad "the no-delete flag was not passed on (rc=$RC, skip='$(cat "$CALLS.skip")')"
unset BACKUP2_NO_DELETE
grep -q 'BACKUP_SKIP_PRUNE' scripts/backup-offsite.sh && ok "backup-offsite.sh honours BACKUP_SKIP_PRUNE" || bad "backup-offsite.sh ignores BACKUP_SKIP_PRUNE, so the flag does nothing"

reset; configure; export FAIL_DUMP=1
run
[ "$RC" = 1 ] && [ "$(calls)" = 2 ] && ok "the dump copy fails: exit 1, but the objects are still attempted" || bad "one failure must not skip the other (rc=$RC, calls=$(calls))"

# Wiring: the cron block runs it, the freshness check watches it, the template documents it.
grep -q 'backup-second-provider.sh' scripts/install-host-cron.sh && ok "cron: scheduled" || bad "install-host-cron.sh does not schedule the second provider"
grep -q 'second_provider_env' scripts/check-backup-freshness.sh && grep -q 'BACKUP2_LOG' scripts/check-backup-freshness.sh &&
  ok "freshness: watches the second provider's log and reads its dump back" || bad "check-backup-freshness.sh does not watch the second provider"
grep -q '^# BACKUP2_OFFSITE_DEST=' .env.production.example && ok "template: documented in .env.production.example" || bad ".env.production.example does not document BACKUP2_*"

[ "$fails" -eq 0 ] && echo "second backup provider: all checks passed" || {
  echo "second backup provider: $fails check(s) failed"
  exit 1
}
