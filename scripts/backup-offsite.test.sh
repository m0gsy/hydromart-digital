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

# No ops pings from a drill. This file produces ten non-zero exits on purpose, and the
# webhook being empty makes alert() return before it ever reaches curl.
#
# This comment used to read "backup-offsite.sh alerts on every non-zero exit" — stated, never
# measured, and false: the EXIT trap was installed after the destination check, so the eight
# exits above it were silent. Section 12 below now measures it instead of asserting it.
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
printf 'hydromart-fake-dump-payload-0123456789\n' >"$HMD"
printf 'aiweb-fake-dump-payload-0123456789\n' >"$AIW"
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

# The tripwire: a twin that is really the plaintext (the hurried `cp` where openssl was).
FAKE="$SRC/hydromart-20260828-030000.sql.gz"
echo 'plaintext' | gzip >"$FAKE"
cp "$FAKE" "$FAKE.enc"
run env BACKUP_OFFSITE_DEST="$D8REM" bash scripts/backup-offsite.sh "$FAKE"
expect "a twin that is not an envelope is refused" 1 "not encrypted"
[ ! -e "$D8REM/$(basename "$FAKE").enc" ] && ok "  ...and nothing was sent" || bad "  ...the plaintext twin was sent"
rm -f "$FAKE" "$FAKE.enc"

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

if [ "$fails" -gt 0 ]; then
  echo "backup-offsite.sh: $fails check(s) failed" >&2
  exit 1
fi
echo "backup-offsite.sh: all checks passed"
