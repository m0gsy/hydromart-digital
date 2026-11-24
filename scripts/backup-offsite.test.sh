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
#   3. a corrupted copy is detected rather than counted as a backup;
#   4. (D8) what leaves the box is ciphertext that only the owner's private key opens, back to
#      the dump byte for byte, and no certificate means nothing leaves at all.
#
# All of them are exercised here against a temp directory standing in for the remote, so this
# needs no network, no credentials and no bucket. The s3:// branch is exercised as far as it
# can be without a real bucket: its credential gate, and the masking of a credential that IS
# set when the endpoint refuses the connection.
#
# The one thing this cannot prove is a real PutObject/GetObject round-trip against BiznetGio
# NEO. That needs a bucket and a key pair, and neither belongs in a repo — run
# `bash scripts/backup-offsite.sh` once on the VPS after setting them and read its last line.
# Nor can it prove that the OWNER's private key opens what the committed certificate seals:
# that key is nowhere near this repo, which is the point. DEPLOY.md's off-box drill proves it.
set -uo pipefail
cd "$(dirname "$0")/.."

# No ops pings from a drill. This file produces many non-zero exits on purpose, and every one
# of them alerts. The sink is a curl on PATH that only records its argv: nothing can reach a
# webhook, whatever ./.env says (scripts/lib/deploy-common.sh reads it, so an empty
# ALERT_WEBHOOK_URL here would not silence anything). Section 12 reads the same recording.
TMP_STUB="$(mktemp -d)"
cat >"$TMP_STUB/curl" <<'STUBEOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"${ALERT_CAPTURE:-/dev/null}"
STUBEOF
chmod +x "$TMP_STUB/curl"
export PATH="$TMP_STUB:$PATH"
export ALERT_WEBHOOK_URL='http://alert.invalid/hook'
export ALERT_CAPTURE="$TMP_STUB/alerts-all"

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
trap 'rm -rf "$TMP" "$TMP_STUB"' EXIT
SRC="$TMP/backups"
REM="$TMP/remote"
mkdir -p "$SRC" "$REM"

# D8: every copy is encrypted to a certificate. The drill makes its own keypair so it can open
# what was sent; `//CN=` has two slashes for Git Bash (backup-env.test.sh says why).
openssl req -x509 -newkey rsa:2048 -keyout "$TMP/priv.pem" -out "$TMP/pub.pem" -days 1 -nodes \
  -subj "//CN=hydromart-offsite-test" >/dev/null 2>&1
[ -s "$TMP/pub.pem" ] && [ -s "$TMP/priv.pem" ] || {
  echo "  FAIL could not generate a test keypair — nothing below would have measured anything" >&2
  exit 1
}
export BACKUP_ENV_CERT="$TMP/pub.pem"

# Real gzip of pg_dumpall-shaped text with a row in it, so "what left is not the dump" can be
# asserted from the outside: not gzip, no row readable, and it opens back to exactly these bytes.
# The name is the glob backup-db.sh writes and this script looks for.
DUMP="$SRC/hydromart-20260825-030000.sql.gz"
{
  echo '--'
  echo '-- PostgreSQL database cluster dump'
  echo '--'
  echo "INSERT INTO customers VALUES (1, 'SENTINEL-ROW-DO-NOT-LEAK');"
} | gzip >"$DUMP"
LOCAL_SHA="$(sha256sum "$DUMP" | cut -d' ' -f1)"
# What is SENT, and so read back and compared, is the dump's encrypted twin.
SENT="$REM/$(basename "$DUMP").enc"

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
if [ -f "$SENT" ]; then
  ok "the copy is actually at the destination, named <dump>.enc"
else
  bad "the copy is actually at the destination, named <dump>.enc"
fi
if [ -e "$REM/$(basename "$DUMP")" ]; then
  bad "the plaintext dump itself reached the destination"
else
  ok "the plaintext dump itself never reaches the destination"
fi
# Checked here independently, not taken from the script's own output: the test must be able
# to disagree with it.
if cmp -s "$SENT" "$DUMP.enc"; then
  ok "destination bytes are the encrypted twin kept beside the dump"
else
  bad "destination bytes are the encrypted twin kept beside the dump"
fi
# `|| true` on every bare command from here on: run() leaves `set -e` on, and a missing file
# must be reported by an assertion, not end the drill before the assertions that would say so.
SENT_SHA="$(sha256sum "$SENT" | cut -d' ' -f1 || true)"
SENT_SIZE="$(wc -c <"$SENT" | tr -d ' ' || true)"
case "$OUT" in
  *"$SENT_SHA"*) ok "prints the sha256 it verified, so the log is evidence" ;;
  *) bad "prints the sha256 it verified, so the log is evidence" ;;
esac
# Matched against the post-verification sentence, not the header line: "(50B)" is printed
# before anything has been read back, so the first draft of this assertion passed green
# during the run where the copy was in fact failing.
case "$OUT" in
  *"verified by read-back: ${SENT_SIZE}B"*) ok "prints the size it verified" ;;
  *) bad "prints the size it verified" ;;
esac
# The dump's own hash: the number the owner's drill compares an opened copy with.
case "$OUT" in
  *"encrypted from $(basename "$DUMP"), sha256 $LOCAL_SHA"*) ok "prints the dump's own sha256, for the drill off the box" ;;
  *) bad "prints the dump's own sha256, for the drill off the box" ;;
esac

# --- 4b. D8: what left is ciphertext, and the owner's key opens it to the dump ------------
if [ "$(head -c 2 "$SENT" | od -An -tx1 | tr -d '[:space:]')" != 1f8b ] && ! gzip -t "$SENT" 2>/dev/null; then
  ok "what left the box is not gzip"
else
  bad "what left the box is gzip: the dump itself"
fi
if grep -qa 'SENTINEL-ROW' "$SENT" || gunzip -c "$SENT" 2>/dev/null | grep -qa 'SENTINEL-ROW'; then
  bad "a row of the dump can be read out of what left the box"
else
  ok "no row of the dump can be read out of what left the box"
fi
case "$(head -c 32 "$SENT" | od -An -tx1 | tr -d '[:space:]')" in
  *06092a864886f70d010703*) ok "it is a PKCS#7 envelope, the .env backup's format" ;;
  *) bad "it is not a PKCS#7 envelope" ;;
esac
# The owner's command, as DEPLOY.md gives it.
rm -f "$TMP/opened.sql.gz"
openssl smime -decrypt -binary -inform DER -in "$SENT" -inkey "$TMP/priv.pem" -out "$TMP/opened.sql.gz" 2>/dev/null || true
if cmp -s "$TMP/opened.sql.gz" "$DUMP"; then
  ok "the matching private key opens it to the dump, byte for byte"
else
  bad "the matching private key does not open it to the dump — the copy would be unreadable"
fi

# --- 5. idempotent under cron -------------------------------------------------------------
# And the twin is REUSED, never remade: a second encryption is different bytes (a fresh key
# every time), and the copy offsite could then never be compared with anything.
TWIN_SHA="$(sha256sum "$DUMP.enc" | cut -d' ' -f1 || true)"
run env BACKUP_OFFSITE_DEST="$REM" bash scripts/backup-offsite.sh "$DUMP"
expect "a second run verifies and copies nothing" 0 "already offsite"
if [ -n "$TWIN_SHA" ] && [ "$(sha256sum "$DUMP.enc" | cut -d' ' -f1)" = "$TWIN_SHA" ]; then
  ok "  ...and reuses the twin instead of encrypting again"
else
  bad "  ...the twin was re-encrypted, so it no longer matches the copy offsite"
fi

# --- 6. a corrupted copy is DETECTED ------------------------------------------------------
# One byte, same length. This is the case a size check cannot see, which is why the script
# hashes at all — flip it and --verify must go red on a file it would otherwise call a
# backup. `conv=notrunc` keeps the length identical.
printf 'X' | dd of="$SENT" bs=1 seek=3 conv=notrunc status=none
run env BACKUP_OFFSITE_DEST="$REM" bash scripts/backup-offsite.sh --verify "$DUMP"
expect "detects one flipped byte at the same size" 1 "WRONG bytes"

# ...and the ordinary run repairs it rather than living with it.
run env BACKUP_OFFSITE_DEST="$REM" bash scripts/backup-offsite.sh "$DUMP"
expect "a copy run repairs a corrupted remote" 0 "offsite OK"

# --- 7. a truncated copy is reported as truncated ----------------------------------------
truncate -s 5 "$SENT"
run env BACKUP_OFFSITE_DEST="$REM" bash scripts/backup-offsite.sh --verify "$DUMP"
expect "detects a truncated copy and says so" 1 "truncated copy"

# --- 8. --verify on something that was never copied --------------------------------------
rm -f "$SENT"
run env BACKUP_OFFSITE_DEST="$REM" bash scripts/backup-offsite.sh --verify "$DUMP"
expect "--verify fails when the dump is not offsite at all" 1 "is NOT offsite"
if [ -f "$SENT" ]; then
  bad "--verify never uploads"
else
  ok "--verify never uploads"
fi

# --- 9. the newest dump is the one that goes -----------------------------------------------
# Copying yesterday's dump every night is a silent, plausible-looking failure: the file is
# there, the checksum matches, and the data is a day old.
OLD="$SRC/hydromart-20260824-030000.sql.gz"
printf 'yesterday\n' | gzip >"$OLD"
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

# --- 12. the alert actually FIRES on the failure a fresh box will hit -----------------------
# Every check above asserts an exit code and a message on stderr. Cron reads neither. The
# thing that reaches a human is alert(), and until this section existed nothing here had ever
# observed one — which is how the trap came to sit below the destination check, silencing the
# single most likely failure on a box nobody has configured yet.
#
# alert() ends in `curl -fsS -X POST ... "$url"`, so a curl earlier on PATH that records its
# argv is the whole instrument: no network, no webhook, no sockets.
STUB="$TMP/stub"
mkdir -p "$STUB"
cat >"$STUB/curl" <<'STUBEOF'
#!/usr/bin/env bash
printf '%s
' "$*" >>"$ALERT_CAPTURE"
STUBEOF
chmod +x "$STUB/curl"

alerts_from() {
  : >"$TMP/alerts"
  ALERT_CAPTURE="$TMP/alerts"     ALERT_WEBHOOK_URL='http://alert.invalid/hook'     PATH="$STUB:$PATH"     "$@" >/dev/null 2>&1 || true
  cat "$TMP/alerts"
}

got="$(alerts_from env -u BACKUP_OFFSITE_DEST bash scripts/backup-offsite.sh "$DUMP")"
case "$got" in
  *"offsite backup of"*FAILED*) ok "an unconfigured box wakes somebody, not just cron's log" ;;
  '') bad "an unconfigured box wakes somebody — alert() was never called at all" ;;
  *) bad "an unconfigured box wakes somebody — alerted, but said: $(echo "$got" | head -1)" ;;
esac

# And the late failures must still name the artefact, which is what $FAIL_WHAT buys: the
# early exits say "the newest dump" because they happen before the key is known, this one
# says the key.
got="$(alerts_from env BACKUP_OFFSITE_DEST="$TMP/no-such-mount" bash scripts/backup-offsite.sh "$DUMP")"
case "$got" in
  *"hydromart-20260825-030000.sql.gz"*) ok "a late failure names the dump it failed to copy" ;;
  *) bad "a late failure names the dump — said: $(echo "$got" | head -1)" ;;
esac

# 3.01: the dir branch replaced the alert trap with `trap 'rm -f "$tmp"' EXIT` before the
# copy, so a `cp` that failed (full disk, dead mount) exited under set -e with NO alert, the
# one failure this script exists to report. A cp that fails must still page.
CPFAIL="$TMP/cpfail"
mkdir -p "$CPFAIL"
printf '#!/usr/bin/env bash
exit 1
' >"$CPFAIL/cp"
chmod +x "$CPFAIL/cp"
mkdir -p "$TMP/live-mount"
got="$(alerts_from env BACKUP_OFFSITE_DEST="$TMP/live-mount" PATH="$CPFAIL:$STUB:$PATH" bash scripts/backup-offsite.sh "$DUMP")"
case "$got" in
  *"offsite backup of"*FAILED*) ok "a copy that fails mid-run still pages somebody" ;;
  '') bad "a copy that fails mid-run pages nobody — the cleanup trap replaced the alert trap" ;;
  *) bad "a copy that fails mid-run — alerted, but said: $(echo "$got" | head -1)" ;;
esac

# --help is somebody at a terminal, not a backup that failed. It exits 0, so the trap's
# own `rc -ne 0` guard covers it — measured, because installing the trap earlier is exactly
# the change that could have started paging on a help screen.
got="$(alerts_from bash scripts/backup-offsite.sh --help)"
[ -z "$got" ] && ok "--help pages nobody" || bad "--help paged: $got"

# --- 13. HD-9b: the AI web's dumps (--aiweb) ------------------------------------------------
# A family of its own in the SAME directory: --aiweb takes the newest aiweb-*.sql.gz, and a run
# without it takes hydromart's newest even when an AI web dump is newer. Either picking the other's
# file would leave one database without an offsite copy while the log said OK.
AISRC="$TMP/ai-backups"
AIREM="$TMP/ai-remote"
mkdir -p "$AISRC" "$AIREM"
HMD="$AISRC/hydromart-20260901-030000.sql.gz"
AIW="$AISRC/aiweb-20260901-030500.sql.gz"
printf 'hydromart-fake-dump-payload-0123456789\n' | gzip >"$HMD"
printf 'aiweb-fake-dump-payload-0123456789\n' | gzip >"$AIW"
touch -d '2026-09-01 03:00:00' "$HMD" 2>/dev/null || touch -t 202609010300 "$HMD"
touch -d '2026-09-01 03:05:00' "$AIW" 2>/dev/null || touch -t 202609010305 "$AIW"
run env BACKUP_OFFSITE_DEST="$AIREM" BACKUP_DIR="$AISRC" bash scripts/backup-offsite.sh --aiweb
expect "--aiweb copies the newest AI web dump and verifies it" 0 "aiweb-20260901-030500.sql.gz"
run env BACKUP_OFFSITE_DEST="$AIREM" BACKUP_DIR="$AISRC" bash scripts/backup-offsite.sh
expect "without --aiweb, hydromart's newest dump goes although the AI web's is newer" 0 "hydromart-20260901-030000.sql.gz"
run env BACKUP_OFFSITE_DEST="$AIREM" BACKUP_DIR="$AISRC" bash scripts/backup-offsite.sh --verify --aiweb
expect "--verify --aiweb (either order) reads the AI web dump back" 0 "already offsite"
# s3: the AI web's objects go BESIDE db/ (db-aiweb/), so each prefix keeps its own 14.
run env BACKUP_OFFSITE_DEST=s3://hydromart-backups/db BACKUP_S3_ENDPOINT=http://127.0.0.1:1 \
  BACKUP_S3_ACCESS_KEY_ID=fake-id BACKUP_S3_SECRET_ACCESS_KEY=fake-secret BACKUP_DIR="$AISRC" \
  bash scripts/backup-offsite.sh --aiweb
case "$OUT" in
  *"s3://hydromart-backups/db-aiweb/aiweb-20260901-030500.sql.gz.enc"*) ok "an AI web dump goes to <prefix>-aiweb/, encrypted, never under hydromart's db/" ;;
  *) bad "the AI web object key: $(echo "$OUT" | grep -m1 'offsite:')" ;;
esac
run env BACKUP_OFFSITE_DEST=s3://hydromart-backups/db BACKUP_S3_ENDPOINT=http://127.0.0.1:1 \
  BACKUP_S3_ACCESS_KEY_ID=fake-id BACKUP_S3_SECRET_ACCESS_KEY=fake-secret BACKUP_DIR="$AISRC" \
  bash scripts/backup-offsite.sh
case "$OUT" in
  *"s3://hydromart-backups/db/hydromart-20260901-030000.sql.gz.enc"*) ok "hydromart's dump still goes to db/, encrypted" ;;
  *) bad "hydromart's object key: $(echo "$OUT" | grep -m1 'offsite:')" ;;
esac
# No AI web dump at all: nothing is missing when the AI web is not on this box; loud when it is.
rm -f "$AIW"
run env BACKUP_OFFSITE_DEST="$AIREM" BACKUP_DIR="$AISRC" AIWEB_DB_CONTAINER= bash scripts/backup-offsite.sh --aiweb
expect "no AI web here: no AI web dump is expected, exit 0" 0 "not on this box"
run env BACKUP_OFFSITE_DEST="$AIREM" BACKUP_DIR="$AISRC" AIWEB_DB_CONTAINER=some-db bash scripts/backup-offsite.sh --aiweb
expect "the AI web is here and has no dump: loud, naming its job" 2 "has scripts/backup-aiweb-db.sh ever run"

# --- 14. D8: no certificate, no copy; one twin per dump; old plaintext left alone ----------
NEW="$SRC/hydromart-20260827-030000.sql.gz"
echo 'tomorrow' | gzip >"$NEW"
D8REM="$TMP/d8-remote"
mkdir -p "$D8REM"

# The state a box is in when the certificate is gone: never a plaintext copy instead.
run env BACKUP_OFFSITE_DEST="$D8REM" BACKUP_ENV_CERT="$TMP/no-such-cert.pem" bash scripts/backup-offsite.sh "$NEW"
expect "no certificate: refuses with exit 2, nothing sent" 2 "encrypted or not at all"
if [ -z "$(ls -A "$D8REM")" ] && [ ! -e "$NEW.enc" ]; then
  ok "  ...nothing reached the destination, not even in the clear"
else
  bad "  ...something was written without a certificate: $(ls -A "$D8REM" | tr '\n' ' ')"
fi
got="$(alerts_from env BACKUP_OFFSITE_DEST="$D8REM" BACKUP_ENV_CERT="$TMP/no-such-cert.pem" bash scripts/backup-offsite.sh "$NEW")"
case "$got" in
  *"offsite backup of"*FAILED*) ok "  ...and it pages, like every night nothing left the box" ;;
  *) bad "  ...a missing certificate paged nobody: '$got'" ;;
esac

# --verify only reads: a dump never sent has no twin, and --verify does not make one.
run env BACKUP_OFFSITE_DEST="$D8REM" bash scripts/backup-offsite.sh --verify "$NEW"
expect "--verify on a dump never sent: not offsite" 1 "never been"
[ ! -e "$NEW.enc" ] && ok "  ...and --verify never encrypts" || bad "  ...--verify made a twin"

# The committed certificate is the default, so a box nobody configured still encrypts, to the
# owner's key (its issuer name travels in the envelope, and the test key's is different).
run env -u BACKUP_ENV_CERT BACKUP_OFFSITE_DEST="$D8REM" bash scripts/backup-offsite.sh "$NEW"
expect "BACKUP_ENV_CERT unset: ops/env-backup-public.pem encrypts it" 0 "offsite OK"
if grep -qa 'hydromart-env-backup' "$D8REM/$(basename "$NEW").enc" 2>/dev/null; then
  ok "  ...addressed to the committed certificate"
else
  bad "  ...not addressed to the committed certificate"
fi

# The second provider gets the SAME bytes: one twin per dump, so every copy and every --verify
# compare against one file.
D8REM2="$TMP/d8-second"
mkdir -p "$D8REM2"
run env BACKUP_OFFSITE_DEST="$D8REM2" bash scripts/backup-offsite.sh "$NEW"
expect "a second destination gets its copy" 0 "offsite OK"
if cmp -s "$D8REM/$(basename "$NEW").enc" "$D8REM2/$(basename "$NEW").enc"; then
  ok "  ...byte-identical to the first destination's"
else
  bad "  ...different bytes from the first destination's: the twin was not reused"
fi

# The tripwire: a twin that is really the plaintext (the hurried `cp` where openssl was) is
# never sent: the upload path deletes it and encrypts again, --verify refuses it.
FAKE="$SRC/hydromart-20260828-030000.sql.gz"
echo 'plaintext' | gzip >"$FAKE"
cp "$FAKE" "$FAKE.enc"
run env BACKUP_OFFSITE_DEST="$D8REM" bash scripts/backup-offsite.sh --verify "$FAKE"
expect "--verify refuses a twin that is not an envelope" 1 "is not encrypted"
run env BACKUP_OFFSITE_DEST="$D8REM" bash scripts/backup-offsite.sh "$FAKE"
expect "the upload path replaces a plaintext twin with a real one" 0 "offsite OK"
if cmp -s "$D8REM/$(basename "$FAKE").enc" "$FAKE" || grep -qa 'plaintext' "$D8REM/$(basename "$FAKE").enc"; then
  bad "  ...the plaintext twin was sent"
else
  ok "  ...and only the encrypted one was sent"
fi
rm -f "$FAKE" "$FAKE.enc" "$FAKE.enc.sha256"

# A plaintext copy an older release sent does not count, and is never deleted: the next copy
# lands beside it.
PRE="$TMP/pre-d8-remote"
mkdir -p "$PRE"
cp "$NEW" "$PRE/"
run env BACKUP_OFFSITE_DEST="$PRE" bash scripts/backup-offsite.sh --verify "$NEW"
expect "a plaintext copy sent before D8 is not the dump being offsite" 1 "is NOT offsite"
run env BACKUP_OFFSITE_DEST="$PRE" bash scripts/backup-offsite.sh "$NEW"
expect "  ...the next copy sends the encrypted one" 0 "offsite OK"
if cmp -s "$PRE/$(basename "$NEW")" "$NEW"; then
  ok "  ...and leaves the old plaintext object where it was"
else
  bad "  ...the old plaintext object was touched"
fi

# A twin lives as long as its dump: backup-db.sh's retention removes a dump, the next copy run
# removes its twin, and keeps the others.
run env BACKUP_OFFSITE_DEST="$D8REM" bash scripts/backup-offsite.sh "$OLD"
rm -f "$OLD" "$D8REM/$(basename "$NEW").enc"
run env BACKUP_OFFSITE_DEST="$D8REM" bash scripts/backup-offsite.sh "$NEW"
if [ ! -e "$OLD.enc" ] && [ -e "$NEW.enc" ] && [ -e "$DUMP.enc" ]; then
  ok "a pruned dump's twin goes with it, the others stay"
else
  bad "twins after a prune: old=$([ -e "$OLD.enc" ] && echo kept || echo gone) new=$([ -e "$NEW.enc" ] && echo kept || echo gone)"
fi

# --- 15. D8 review: the twin is checked whole and tied to its dump before anything leaves --
REALSSL="$(command -v openssl)"
mkdir -p "$TMP/ssl-stub"
# An openssl whose `smime` exits 0 and leaves a TRUNCATED envelope: what 3.0.2 does on a full
# disk. SSL_CUT_FIRST=n makes only the first n encryptions short; unset = every one.
cat >"$TMP/ssl-stub/openssl" <<STUBEOF
#!/usr/bin/env bash
if [ "\${1:-}" = smime ]; then
  "$REALSSL" "\$@" || exit \$?
  n=\$(cat "\$SSL_COUNT" 2>/dev/null || echo 0); n=\$((n + 1)); echo "\$n" >"\$SSL_COUNT"
  if [ "\$n" -le "\${SSL_CUT_FIRST:-999}" ]; then
    out=""; prev=""; for a in "\$@"; do [ "\$prev" = -out ] && out="\$a"; prev="\$a"; done
    head -c 200 "\$out" >"\$out.cut" && mv -f "\$out.cut" "\$out"
  fi
  exit 0
fi
exec "$REALSSL" "\$@"
STUBEOF
chmod +x "$TMP/ssl-stub/openssl"
gz() { printf '%s\n' "$2" | gzip >"$1"; }
TRD="$TMP/d15"
mkdir -p "$TRD/src" "$TRD/rem"
D1="$TRD/src/hydromart-20260901-040000.sql.gz"
gz "$D1" "dump one"

# a. a full disk during encryption: every twin cut short -> exit 1, nothing sent, no twin left
: >"$TMP/ssl-count"
run env PATH="$TMP/ssl-stub:$PATH" SSL_COUNT="$TMP/ssl-count" BACKUP_OFFSITE_DEST="$TRD/rem" bash scripts/backup-offsite.sh "$D1"
expect "a truncated twin made twice is a failure, not a copy" 1 "Nothing was sent"
if [ -z "$(ls -A "$TRD/rem")" ] && [ ! -e "$D1.enc" ]; then
  ok "  ...nothing reached the destination and no short twin is left behind"
else
  bad "  ...a short twin or a copy was left: rem=$(ls -A "$TRD/rem" | tr '\n' ' ') twin=$([ -e "$D1.enc" ] && echo yes || echo no)"
fi
# b. only the first encryption is cut short: it is remade once and what goes is whole
: >"$TMP/ssl-count"
run env PATH="$TMP/ssl-stub:$PATH" SSL_COUNT="$TMP/ssl-count" SSL_CUT_FIRST=1 BACKUP_OFFSITE_DEST="$TRD/rem" bash scripts/backup-offsite.sh "$D1"
expect "a twin cut short once is encrypted again and sent whole" 0 "offsite OK"
openssl asn1parse -inform DER -in "$TRD/rem/$(basename "$D1").enc" >/dev/null 2>&1 \
  && ok "  ...what was sent parses as DER to its end" || bad "  ...what was sent is not a whole envelope"
[ "$(cat "$D1.enc.sha256" 2>/dev/null)" = "$(sha256sum "$D1" | cut -d' ' -f1)" ] \
  && ok "  ...and its dump's sha256 is recorded beside the twin" || bad "  ...no dump sha256 recorded beside the twin"

# c. a good twin gets cut short afterwards (reuse): upload path remakes it, --verify fails and leaves it
head -c 300 "$D1.enc" >"$TRD/cut" && cp "$TRD/cut" "$D1.enc"
rm -f "$TRD/rem/"* 2>/dev/null || true
run env BACKUP_OFFSITE_DEST="$TRD/rem" bash scripts/backup-offsite.sh --verify "$D1"
expect "--verify fails on a truncated twin" 1 "not a complete DER envelope"
[ "$(wc -c <"$D1.enc" | tr -d ' ')" = 300 ] && ok "  ...and never re-encrypts" || bad "  ...--verify touched the twin"
run env BACKUP_OFFSITE_DEST="$TRD/rem" bash scripts/backup-offsite.sh "$D1"
expect "a truncated twin on reuse is deleted and encrypted again" 0 "offsite OK"
openssl asn1parse -inform DER -in "$D1.enc" >/dev/null 2>&1 && ok "  ...the twin is whole again" || bad "  ...the twin is still cut short"

# d. a twin that belongs to an OLDER dump of the same name
gz "$D1" "dump one, written again"
run env BACKUP_OFFSITE_DEST="$TRD/rem" bash scripts/backup-offsite.sh --verify "$D1"
expect "--verify fails on a twin made from a different dump" 1 "was not made from"
OLDTWIN="$(sha256sum "$D1.enc" | cut -d' ' -f1)"
run env BACKUP_OFFSITE_DEST="$TRD/rem" bash scripts/backup-offsite.sh "$D1"
expect "the upload path encrypts the dump as it is now" 0 "offsite OK"
if [ "$(sha256sum "$D1.enc" | cut -d' ' -f1)" != "$OLDTWIN" ] \
  && [ "$(cat "$D1.enc.sha256")" = "$(sha256sum "$D1" | cut -d' ' -f1)" ]; then
  ok "  ...a new twin, tied to the new dump"
else
  bad "  ...the stale twin was reused"
fi

# e. a dump that is not valid gzip is an alert, not an upload
D2="$TRD/src/hydromart-20260902-040000.sql.gz"
gz "$D2" "dump two, long enough to cut in two parts"
head -c 20 "$D2" >"$TRD/cutgz" && cp "$TRD/cutgz" "$D2"
: >"$TMP_STUB/alerts-all"
run env BACKUP_OFFSITE_DEST="$TRD/rem" bash scripts/backup-offsite.sh "$D2"
expect "a corrupt dump is refused" 1 "not valid gzip"
{ [ ! -e "$D2.enc" ] && [ ! -e "$TRD/rem/$(basename "$D2").enc" ]; } && ok "  ...nothing encrypted, nothing sent" || bad "  ...a corrupt dump was encrypted or sent"
grep -q 'FAILED' "$TMP_STUB/alerts-all" && ok "  ...and it alerts" || bad "  ...it did not alert"
rm -f "$D2"

# f. orphans: a twin (and its hash) whose dump is gone, a stale part file; never a live one
D3="$TRD/src/hydromart-20260903-040000.sql.gz"
gz "$D3" "dump three"
GONE="$TRD/src/hydromart-20260801-040000.sql.gz"
echo x >"$GONE.enc"; echo x >"$GONE.enc.sha256"
echo x >"$TRD/src/.hydromart-20260801-040000.sql.gz.part"
touch -d '2026-08-01 04:00:00' "$TRD/src/.hydromart-20260801-040000.sql.gz.part" 2>/dev/null || touch -t 202608010400 "$TRD/src/.hydromart-20260801-040000.sql.gz.part"
echo x >"$TRD/src/.hydromart-20260903-050000.sql.gz.part"   # fresh: a dump may be writing it now
if [ -e "$GONE.enc" ] && [ -e "$GONE.enc.sha256" ] && [ -e "$TRD/src/.hydromart-20260801-040000.sql.gz.part" ]; then
  ok "orphans exist before the run (the precondition is real)"
else
  bad "orphans exist before the run — the test set nothing up"
fi
run env BACKUP_OFFSITE_DEST="$TRD/rem" bash scripts/backup-offsite.sh "$D3"
expect "a run with orphans around still copies" 0 "offsite OK"
if [ ! -e "$GONE.enc" ] && [ ! -e "$GONE.enc.sha256" ] && [ ! -e "$TRD/src/.hydromart-20260801-040000.sql.gz.part" ]; then
  ok "  ...the orphan twin, its hash and the stale part file are gone"
else
  bad "  ...orphans left: $(ls -A "$TRD/src" | tr '\n' ' ')"
fi
if [ -e "$D1" ] && [ -e "$D1.enc" ] && [ -e "$D1.enc.sha256" ] && [ -e "$D3.enc" ] && [ -e "$TRD/src/.hydromart-20260903-050000.sql.gz.part" ]; then
  ok "  ...and no dump, live twin or fresh part file was touched"
else
  bad "  ...cleanup touched something in use: $(ls -A "$TRD/src" | tr '\n' ' ')"
fi

# g. what is handed to the uploader (s3 shape): the .enc, ciphertext, never the gzip
CAP="$TMP/upcap"
mkdir -p "$CAP" "$TMP/node-stub"
cat >"$TMP/node-stub/node" <<'STUBEOF'
#!/usr/bin/env bash
case "${1:-}" in
  scripts/upload-to-s3.mjs)
    echo "$*" >>"$UPCAP/args"
    cp "$2" "$UPCAP/uploaded"
    ;;
  scripts/s3-prune.mjs) ;;
  -e)
    [ -f "$UPCAP/uploaded" ] || exit 3
    echo "$(wc -c <"$UPCAP/uploaded" | tr -d ' ') $(sha256sum "$UPCAP/uploaded" | cut -d' ' -f1)"
    ;;
  *) exit 1 ;;
esac
STUBEOF
chmod +x "$TMP/node-stub/node"
D4="$TRD/src/hydromart-20260904-040000.sql.gz"
gz "$D4" "dump four SENTINEL-ROW"
run env PATH="$TMP/node-stub:$PATH" UPCAP="$CAP" BACKUP_OFFSITE_DEST=s3://hydromart-backups/db \
  BACKUP_S3_ACCESS_KEY_ID=fake-id BACKUP_S3_SECRET_ACCESS_KEY=fake-secret bash scripts/backup-offsite.sh "$D4"
expect "s3: a copy through a stubbed uploader verifies" 0 "offsite OK"
case "$(cat "$CAP/args" 2>/dev/null)" in
  "scripts/upload-to-s3.mjs $D4.enc db/hydromart-20260904-040000.sql.gz.enc") ok "the uploader is handed <dump>.enc and the .enc object key" ;;
  *) bad "the uploader was handed: $(cat "$CAP/args" 2>/dev/null)" ;;
esac
UPHEX="$(head -c 32 "$CAP/uploaded" | od -An -tx1 | tr -d '[:space:]')"
case "$UPHEX" in
  30*06092a864886f70d010703*) ok "the uploaded file is a PKCS#7 envelope (SEQUENCE, enveloped-data OID)" ;;
  *) bad "the uploaded file starts $UPHEX" ;;
esac
if cmp -s "$CAP/uploaded" "$D4" || grep -qa 'SENTINEL-ROW' "$CAP/uploaded" || gzip -t "$CAP/uploaded" 2>/dev/null; then
  bad "the uploader received the plaintext dump or something that is gzip"
else
  ok "the uploader never received the plaintext gzip"
fi

# h. two runs at once: one twin, the same bytes at both destinations
D5="$TRD/src/hydromart-20260905-040000.sql.gz"
gz "$D5" "dump five"
mkdir -p "$TRD/remA" "$TRD/remB"
env BACKUP_OFFSITE_DEST="$TRD/remA" bash scripts/backup-offsite.sh "$D5" >/dev/null 2>&1 &
pidA=$!
env BACKUP_OFFSITE_DEST="$TRD/remB" bash scripts/backup-offsite.sh "$D5" >/dev/null 2>&1 &
pidB=$!
wait "$pidA" || true
wait "$pidB" || true
if [ -s "$TRD/remA/$(basename "$D5").enc" ] && cmp -s "$TRD/remA/$(basename "$D5").enc" "$TRD/remB/$(basename "$D5").enc"; then
  ok "two concurrent runs send the same ciphertext to both destinations"
else
  bad "two concurrent runs sent different ciphertexts (or one failed)"
fi

# i. backup-db.sh writes under a part name and renames, and refuses a dump that is not gzip
DBS="$TMP/db-stub"
mkdir -p "$DBS" "$TMP/db-out"
cat >"$DBS/docker" <<'STUBEOF'
#!/usr/bin/env bash
if [ -n "${DUMP_BAD:-}" ]; then echo 'not gzip data'; else for i in $(seq 1 400); do echo "INSERT INTO t VALUES ($i, 'padding padding padding');"; done; fi
STUBEOF
chmod +x "$DBS/docker"
run env PATH="$DBS:$PATH" BACKUP_DIR="$TMP/db-out" bash scripts/backup-db.sh
if [ "$RC" = 0 ] && ls "$TMP/db-out"/hydromart-*.sql.gz >/dev/null 2>&1 && [ -z "$(ls -A "$TMP/db-out" | grep part || true)" ] \
  && gzip -t "$TMP/db-out"/hydromart-*.sql.gz; then
  ok "backup-db.sh: a good dump lands under its final name, no part file left"
else
  bad "backup-db.sh: exit $RC, dir: $(ls -A "$TMP/db-out" | tr '\n' ' '); $(echo "$OUT" | tail -2 | tr '\n' ' ')"
fi
rm -f "$TMP/db-out"/hydromart-*.sql.gz
run env PATH="$DBS:$PATH" DUMP_BAD=1 BACKUP_DIR="$TMP/db-out" bash scripts/backup-db.sh
if [ "$RC" != 0 ] && [ -z "$(ls -A "$TMP/db-out")" ]; then
  ok "backup-db.sh: a dump that is not gzip fails and leaves nothing under any name"
else
  bad "backup-db.sh: bad dump gave exit $RC, dir: $(ls -A "$TMP/db-out" | tr '\n' ' ')"
fi

if [ "$fails" -gt 0 ]; then
  echo "backup-offsite.sh: $fails check(s) failed" >&2
  exit 1
fi
echo "backup-offsite.sh: all checks passed"
