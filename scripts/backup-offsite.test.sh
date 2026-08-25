#!/usr/bin/env bash
# The runnable check for L2.7 — scripts/backup-offsite.sh.
#
#   bash scripts/backup-offsite.test.sh
#
# Written the way scripts/check-ops-scripts.test.sh is written, and for the same reason: a
# check that cannot go RED is the failure class this whole area exists to close. The three
# things this script claims are all things the repo has previously believed without proof —
#
#   1. an absent credential is a LOUD failure, never a quiet skip;
#   2. a copy is verified by reading it back, not by the uploader's exit code;
#   3. a corrupted copy is detected rather than counted as a backup.
#
# All three are exercised here against a temp directory standing in for the remote, so this
# needs no network, no credentials and no bucket. The s3:// branch is exercised as far as it
# can be without a real bucket: its credential gate, and the masking of a credential that IS
# set when the endpoint refuses the connection.
#
# The one thing this cannot prove is a real PutObject/GetObject round-trip against BiznetGio
# NEO. That needs a bucket and a key pair, and neither belongs in a repo — run
# `bash scripts/backup-offsite.sh` once on the VPS after setting them and read its last line.
set -uo pipefail
cd "$(dirname "$0")/.."

# No ops pings from a drill. backup-offsite.sh alerts on every non-zero exit, and this file
# produces eight of them on purpose.
export ALERT_WEBHOOK_URL=''

fails=0
ok() { echo "  ok   $1"; }
bad() {
  echo "  FAIL $1"
  fails=$((fails + 1))
}

OUT=''
RC=0
run() {
  set +e
  OUT="$("$@" 2>&1)"
  RC=$?
  set -e
}

# `expect <label> <exit> <substring>` — both the status and the wording matter. A precise
# message IS the deliverable here: the operator reading this at 03:00 has to learn which
# key to set from one line of a cron log.
expect() {
  local label="$1" want_rc="$2" want_text="$3"
  if [ "$RC" != "$want_rc" ]; then
    bad "$label (expected exit $want_rc, got $RC; output: $(echo "$OUT" | head -2 | tr '\n' ' '))"
    return
  fi
  case "$OUT" in
    *"$want_text"*) ok "$label" ;;
    *) bad "$label — exit $RC was right but the message never said '$want_text'; said: $(echo "$OUT" | head -3 | tr '\n' ' ')" ;;
  esac
}

echo "backup-offsite.sh:"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
SRC="$TMP/backups"
REM="$TMP/remote"
mkdir -p "$SRC" "$REM"

# Not real gzip, and it does not need to be — nothing in backup-offsite.sh decompresses the
# artefact. The name is what matters: it is the glob backup-db.sh writes and this script
# looks for.
DUMP="$SRC/hydromart-20260825-030000.sql.gz"
printf 'hydromart-fake-dump-payload-0123456789-abcdefghij\n' >"$DUMP"
LOCAL_SHA="$(sha256sum "$DUMP" | cut -d' ' -f1)"
LOCAL_SIZE="$(wc -c <"$DUMP" | tr -d ' ')"

# --- 1. no destination at all: the state every box is in until somebody configures one ----
# This must be the loud case. A "no offsite destination" box that exits 0 is how fourteen
# copies of a database end up on the disk that database lives on, with nothing saying so.
run env -u BACKUP_OFFSITE_DEST bash scripts/backup-offsite.sh "$DUMP"
expect "unconfigured destination fails, naming the key" 2 "BACKUP_OFFSITE_DEST is not set"
case "$OUT" in
  *"$(pwd)/.env"*) ok "says WHICH file the key goes in" ;;
  *) bad "says WHICH file the key goes in" ;;
esac

# --- 2. s3:// with a missing credential --------------------------------------------------
# The access key is a sentinel: if any code path ever echoes a credential, this catches it.
SENTINEL='SENTINEL-ACCESS-KEY-DO-NOT-PRINT'
# `-u` goes BEFORE the assignments: env stops parsing options at the first NAME=VALUE, so
# `env VAR=x -u OTHER cmd` looks for a command literally named `-u` and exits 127. This
# drill caught that in its own first run.
run env -u BACKUP_S3_SECRET_ACCESS_KEY \
  BACKUP_OFFSITE_DEST=s3://hydromart-backups/db \
  BACKUP_S3_ACCESS_KEY_ID="$SENTINEL" \
  bash scripts/backup-offsite.sh "$DUMP"
expect "missing s3 secret fails, naming the key" 2 "BACKUP_S3_SECRET_ACCESS_KEY is not set"
case "$OUT" in
  *"$SENTINEL"*) bad "never prints the credential it DOES have" ;;
  *) ok "never prints the credential it DOES have" ;;
esac
case "$OUT" in
  *"was NOT attempted"*) ok "says plainly that nothing was copied" ;;
  *) bad "says plainly that nothing was copied" ;;
esac

# The same masking on the failure path, where a credential is present and the destination
# refuses the connection. Port 1 is closed on every box, so the SDK fails immediately
# rather than this drill waiting on a network timeout.
run env BACKUP_OFFSITE_DEST=s3://hydromart-backups/db \
  BACKUP_S3_ENDPOINT=http://127.0.0.1:1 \
  BACKUP_S3_ACCESS_KEY_ID="$SENTINEL" \
  BACKUP_S3_SECRET_ACCESS_KEY="$SENTINEL-SECRET" \
  bash scripts/backup-offsite.sh "$DUMP"
if [ "$RC" = 0 ]; then
  bad "an unreachable bucket is a failure (got exit 0)"
else
  ok "an unreachable bucket is a failure (exit $RC)"
fi
case "$OUT" in
  *"$SENTINEL"*) bad "keeps the credential out of the error output too" ;;
  *) ok "keeps the credential out of the error output too" ;;
esac

# --- 3. the L2.7 guard: a "remote" on the same filesystem is not a remote -----------------
run env BACKUP_OFFSITE_DEST="$REM" bash scripts/backup-offsite.sh "$DUMP"
expect "refuses a destination on the same filesystem" 2 "SAME filesystem"

# Everything below is the same-disk temp dir standing in for a mount, so the guard is
# switched off deliberately — which is the only reason that escape hatch exists.
export BACKUP_OFFSITE_ALLOW_SAME_FS=1

# --- 4. a copy, verified by checksum ------------------------------------------------------
run env BACKUP_OFFSITE_DEST="$REM" bash scripts/backup-offsite.sh "$DUMP"
expect "copies and verifies by read-back" 0 "offsite OK"
if [ -f "$REM/$(basename "$DUMP")" ]; then
  ok "the artefact is actually at the destination"
else
  bad "the artefact is actually at the destination"
fi
# Checked here independently, not taken from the script's own output: the test must be able
# to disagree with it.
if [ "$(sha256sum "$REM/$(basename "$DUMP")" | cut -d' ' -f1)" = "$LOCAL_SHA" ]; then
  ok "destination bytes hash to the source's sha256"
else
  bad "destination bytes hash to the source's sha256"
fi
case "$OUT" in
  *"$LOCAL_SHA"*) ok "prints the sha256 it verified, so the log is evidence" ;;
  *) bad "prints the sha256 it verified, so the log is evidence" ;;
esac
# Matched against the post-verification sentence, not the header line: "(50B)" is printed
# before anything has been read back, so the first draft of this assertion passed green
# during the run where the copy was in fact failing.
case "$OUT" in
  *"verified by read-back: ${LOCAL_SIZE}B"*) ok "prints the size it verified" ;;
  *) bad "prints the size it verified" ;;
esac

# --- 5. idempotent under cron -------------------------------------------------------------
run env BACKUP_OFFSITE_DEST="$REM" bash scripts/backup-offsite.sh "$DUMP"
expect "a second run verifies and copies nothing" 0 "already offsite"

# --- 6. a corrupted copy is DETECTED ------------------------------------------------------
# One byte, same length. This is the case a size check cannot see, which is why the script
# hashes at all — flip it and --verify must go red on a file it would otherwise call a
# backup. `conv=notrunc` keeps the length identical.
printf 'X' | dd of="$REM/$(basename "$DUMP")" bs=1 seek=3 conv=notrunc status=none
run env BACKUP_OFFSITE_DEST="$REM" bash scripts/backup-offsite.sh --verify "$DUMP"
expect "detects one flipped byte at the same size" 1 "WRONG bytes"

# ...and the ordinary run repairs it rather than living with it.
run env BACKUP_OFFSITE_DEST="$REM" bash scripts/backup-offsite.sh "$DUMP"
expect "a copy run repairs a corrupted remote" 0 "offsite OK"

# --- 7. a truncated copy is reported as truncated ----------------------------------------
truncate -s 5 "$REM/$(basename "$DUMP")"
run env BACKUP_OFFSITE_DEST="$REM" bash scripts/backup-offsite.sh --verify "$DUMP"
expect "detects a truncated copy and says so" 1 "truncated copy"

# --- 8. --verify on something that was never copied --------------------------------------
rm -f "$REM/$(basename "$DUMP")"
run env BACKUP_OFFSITE_DEST="$REM" bash scripts/backup-offsite.sh --verify "$DUMP"
expect "--verify fails when the dump is not offsite at all" 1 "is NOT offsite"
if [ -f "$REM/$(basename "$DUMP")" ]; then
  bad "--verify never uploads"
else
  ok "--verify never uploads"
fi

# --- 9. the newest dump is the one that goes -----------------------------------------------
# Copying yesterday's dump every night is a silent, plausible-looking failure: the file is
# there, the checksum matches, and the data is a day old.
OLD="$SRC/hydromart-20260824-030000.sql.gz"
printf 'yesterday\n' >"$OLD"
touch -d '2026-08-24 03:00:00' "$OLD" 2>/dev/null || touch -t 202608240300 "$OLD"
touch "$DUMP"
run env BACKUP_OFFSITE_DEST="$REM" BACKUP_DIR="$SRC" bash scripts/backup-offsite.sh
expect "with no argument it picks the NEWEST dump" 0 "$(basename "$DUMP")"
case "$OUT" in
  *"$(basename "$OLD")"*) bad "does not pick up the older dump" ;;
  *) ok "does not pick up the older dump" ;;
esac

# --- 10. an empty artefact is refused -----------------------------------------------------
# sha256("") == sha256(""), so an empty dump verifies perfectly against an empty copy. That
# is the one green result this script must never be able to produce.
: >"$SRC/hydromart-20260826-030000.sql.gz"
run env BACKUP_OFFSITE_DEST="$REM" bash scripts/backup-offsite.sh "$SRC/hydromart-20260826-030000.sql.gz"
expect "refuses a 0-byte dump instead of verifying nothing" 2 "is not a backup"

# --- 11. no dumps anywhere ----------------------------------------------------------------
run env BACKUP_OFFSITE_DEST="$REM" BACKUP_DIR="$TMP/empty" bash scripts/backup-offsite.sh
expect "says so when there is nothing to copy" 2 "has scripts/backup-db.sh ever run"

if [ "$fails" -gt 0 ]; then
  echo "backup-offsite.sh: $fails check(s) failed" >&2
  exit 1
fi
echo "backup-offsite.sh: all checks passed"
