#!/usr/bin/env bash
# L2.7 — get the backup OFF the box that made it, and PROVE the bytes arrived.
#
# `scripts/backup-db.sh` dumps the whole cluster into $BACKUP_DIR on the production VPS and
# keeps the newest 14. All fourteen live on the same disk, in the same VM, in the same rack
# as the Postgres they were taken from: whatever loses the database (a dead volume, a
# deleted VM, a full disk, ransomware running as the deploy user) loses the backups in the
# same second. Fourteen daily copies of a file that dies with its source is one backup of
# nothing.
#
# backup-db.sh used to push the dump to NEO itself when BACKUP_S3_BUCKET was set. Two things
# about that path were why this script exists instead of a comment saying "already handled"
# (and a third, D8 below, is why that path is gone):
#
#   * It failed soft. `WARN: offsite upload to NEO failed — kept local copy`, exit 0, and
#     the only trace is a line in a nightly log nobody reads. Silent success is the exact
#     failure class this repo keeps paying for — see scripts/check-ops-scripts.test.sh and
#     the twenty green checks that measured nothing.
#   * Nothing ever read the object back. A PutObject that returned 200 is a claim about
#     one HTTP request, not about the bytes now sitting in the bucket. A backup nobody has
#     read back is a promise, not a backup.
#
# So: this script copies the newest dump off-box, then reads it back and compares SIZE and
# SHA-256 against what it sent. Non-zero exit on any doubt, including "not configured" —
# a box with no offsite destination must say so every night, not pass quietly.
#
# D8 (owner decision 2026-11-24): what LEAVES the box is encrypted. The dumps ON it stay
# plaintext, so the restore drills read them unchanged. What goes is the dump encrypted to the
# PUBLIC certificate the .env backup uses (BACKUP_ENV_CERT, default ops/env-backup-public.pem;
# scripts/backup-env.sh), with the same openssl command and format (S/MIME enveloped data,
# AES-256, DER), streamed: one private key, held off this box, opens every copy, and the box
# can write tomorrow's copy without being able to read yesterday's. The encrypted twin is made
# once per dump, beside it, as <dump>.enc, and that file is what is sent, read back and
# compared, by this run, by the second provider's and by every --verify: each encryption draws
# a fresh key, so a dump encrypted twice is two different files, and a second encryption could
# never be compared with the copy offsite. The object is named <dump>.enc as well, so the
# plaintext <dump> objects sent before D8 stay told apart; nothing here deletes them (DEPLOY.md
# says how they age out). No certificate is exit 2 with nothing sent, never a plaintext copy.
# The twin is checked whole before anything is sent, whenever it is made or reused: valid DER to
# its end, larger than its dump, and its dump's sha256 recorded beside it as <dump>.enc.sha256
# (openssl 3.0.2 exits 0 on a full disk and leaves a cut-short envelope; a twin could also
# belong to an older dump). A bad twin is deleted and made again once; --verify only fails.
# To force a new encryption: delete <dump>.enc and <dump>.enc.sha256. One run per family at a time
# (flock), so the two providers never get different ciphertexts.
# Opening a copy, off the box: DEPLOY.md, "Offsite copies are encrypted (D8)".
#
#   bash scripts/backup-offsite.sh                     # newest dump in $BACKUP_DIR
#   bash scripts/backup-offsite.sh /path/to/dump.gz     # a specific artefact
#   bash scripts/backup-offsite.sh --verify [file]      # read back + compare, never upload
#   bash scripts/backup-offsite.sh --aiweb [--verify]   # HD-9b: the AI web's dumps instead
#                                                       # (aiweb-*.sql.gz, under <prefix>-aiweb/)
#
# Run it the way cron does — .env is READ, never executed (scripts/load-env.sh; `. ./.env`
# is forbidden in this repo because a raw PEM in .env once aborted a deploy mid-migration):
#
#   cd $REPO && . ./scripts/load-env.sh && bash scripts/backup-offsite.sh
#
# Env:
#   BACKUP_OFFSITE_DEST   REQUIRED. `s3://bucket[/prefix]`, or a directory path that is a
#                         mount of storage which is not in this VM.
#   BACKUP_S3_ENDPOINT    default https://nos.jkt-1.neo.id   (s3:// only)
#   BACKUP_S3_REGION      default jkt-1                      (s3:// only)
#   BACKUP_S3_ACCESS_KEY_ID / BACKUP_S3_SECRET_ACCESS_KEY    (s3:// only, REQUIRED)
#   BACKUP_DIR            default: whichever of /var/backups/hydromart or ~/backups holds
#                         dumps — backup-db.sh picks between the same two.
#   BACKUP_OFFSITE_ALLOW_SAME_FS=1  permit a directory destination on this filesystem.
#   BACKUP_ENV_CERT       default ops/env-backup-public.pem: the PUBLIC certificate the copy is
#                         encrypted to (D8). Not a readable file = exit 2, nothing sent.
#
# Exit codes, because the drill asserts on them: 2 = not configured / nothing to copy (no
# bytes moved), 1 = the copy is not verifiable (this is the loud one), 0 = verified.
#
# Two destination shapes, deliberately:
#   s3://  — what this box actually has. BiznetGio NEO object storage is already in
#            production for uploads, @aws-sdk/client-s3 is already a dependency resolvable
#            from the repo root, and scripts/upload-to-s3.mjs is already the uploader
#            backup-env.sh calls. No `aws` binary, no proprietary CLI, nothing new to
#            install on the host. The BACKUP_S3_* names and the default `db/` prefix are
#            the ones backup-db.sh's own upload used before D8 removed it, so a bucket's
#            history stays under one prefix.
#   a path — a mount (NFS/sshfs/attached volume from another box). It is also the shape the
#            self-check can drive with no network and no credentials, which is the only
#            reason the corruption branch below is provable at all.
# ponytail: no rsync/ssh shape. There is no second Hydromart box to rsync to, it would need
# a key and a host nobody has provisioned, and a mounted path covers it with zero extra
# code. Add the shape when a second box exists.
set -euo pipefail

cd "$(dirname "$0")/.."
# Sourced only for alert(): a failure written to /var/log/hydromart-backup.log is a failure
# nobody reads, which is the same silence this script exists to break.
# shellcheck source=scripts/lib/deploy-common.sh
. ./scripts/lib/deploy-common.sh

# .env is NOT sourced here. Every job in scripts/install-host-cron.sh already prefixes
# `. ./scripts/load-env.sh`, and loading it again here would let a developer's .env
# override an environment the caller (or the drill) set explicitly. The missing-key message
# below tells the operator when that is what bit them.

MODE=copy
# HD-9b: which family of dumps. `hydromart` (backup-db.sh's cluster dumps) unless --aiweb asks for
# the AI web database's (backup-aiweb-db.sh). Each has its own name and its own object prefix, so
# neither can be taken for the newest dump of the other and each prune keeps BACKUP_KEEP of its own.
FAMILY=hydromart
while [ $# -gt 0 ]; do
  case "$1" in
    --verify)
      MODE=verify
      shift
      ;;
    --aiweb)
      FAMILY=aiweb
      shift
      ;;
    -h | --help)
      sed -n '2,65p' "$0"
      exit 0
      ;;
    -*)
      echo "usage: $0 [--aiweb] [--verify] [dump-file]" >&2
      exit 2
      ;;
    *) break ;;
  esac
done

# EVERY exit below this line means no copy of this database left the box tonight, so every
# one of them is worth waking somebody for. That is why the trap is installed HERE and not
# further down: it used to sit after the destination check, so the single most likely
# failure on a fresh box — BACKUP_OFFSITE_DEST never set — exited 2 with the alert trap not
# yet installed. Nightly cron, non-zero, silent. The header two screens up promises "a box
# with no offsite destination must say so every night"; for that one case it did not, and
# this file's own self-test asserted the exit code while its comment claimed the alert.
#
# The arg parse stays above it on purpose: `--help` and a usage typo are somebody at a
# terminal, not a backup that failed.
#
# $FAIL_WHAT is expanded when the trap FIRES, not when it is installed, so an early exit
# names the artefact generically and a late one names the key.
FAIL_WHAT='the newest dump'
[ "$FAMILY" = aiweb ] && FAIL_WHAT='the newest AI web dump'
alert_on_failure() {
  # CLEANUP: a half-written temp file to remove on the way out. It rides in THIS trap — a
  # second `trap ... EXIT` replaces the first, which is how a failed copy used to exit silent.
  trap 'rc=$?; [ -n "${CLEANUP:-}" ] && rm -f "$CLEANUP"; [ "$rc" -ne 0 ] && alert "offsite backup of $FAIL_WHAT FAILED (exit $rc) — the dumps on this box are the only copies"; exit $rc' EXIT
}
alert_on_failure

command -v sha256sum >/dev/null 2>&1 || {
  echo "!! sha256sum not found. Without it this script cannot verify anything, and an" >&2
  echo "   unverified copy is exactly what it exists to replace. Install coreutils." >&2
  exit 2
}
sha256_of() { sha256sum "$1" | cut -d' ' -f1; }

# --- 1. which artefact -------------------------------------------------------------------
# The directory that actually HOLDS dumps, rather than the first one that is writable —
# now shared with restore-db.sh, which used to hardcode the other one (CMP-02).
# shellcheck source=scripts/lib/backup-dir.sh
. ./scripts/lib/backup-dir.sh
BACKUP_DIR="${BACKUP_DIR:-$(hydromart_backup_dir)}"

FILE="${1:-}"
if [ -z "$FILE" ]; then
  FILE="$(ls -1t "$BACKUP_DIR"/"$FAMILY"-*.sql.gz 2>/dev/null | head -1 || true)"
fi
if [ -z "$FILE" ] && [ "$FAMILY" = aiweb ] && [ -z "$(aiweb_db_container)" ]; then
  # No AI web on this box, so no dump of it: nothing is missing. backup-aiweb-db.sh says so once
  # a week; saying it here every night too would be the alert nobody reads.
  echo "no AI web dump to copy: the AI web's database is not on this box"
  exit 0
fi
if [ -z "$FILE" ]; then
  maker=backup-db.sh
  [ "$FAMILY" = aiweb ] && maker=backup-aiweb-db.sh
  echo "!! no $FAMILY-*.sql.gz in $BACKUP_DIR — has scripts/$maker ever run here?" >&2
  echo "   Set BACKUP_DIR if the dumps live somewhere else." >&2
  exit 2
fi
[ -f "$FILE" ] || {
  echo "!! $FILE is not a file" >&2
  exit 2
}
# A zero-byte dump would sail through every checksum comparison below — sha256 of nothing
# equals sha256 of nothing — and this script would then report a verified offsite backup of
# an empty file. That is the most convincing lie it could tell, so it is a hard stop.
# (backup-db.sh already rejects a dump under 1000B at the source; this is the same hole
# seen from the other end, for an artefact handed in by an operator or cut short by a disk.)
[ -s "$FILE" ] || {
  echo "!! $FILE is 0 bytes. Refusing: a verified copy of an empty file is not a backup." >&2
  exit 2
}

# A dump that is not valid gzip is a failed backup (backup-db.sh wrote the final name directly
# before D8's review, so a cut-short dump can wear it): an alert, never something to encrypt and
# send as if it were one.
gzip -t "$FILE" 2>/dev/null || {
  echo "!! $FILE is not valid gzip (cut short or corrupt). Refusing: nothing was sent." >&2
  exit 1
}

# What leaves the box is the dump's encrypted twin, never the dump (D8, made in 2b below).
ENC="$FILE.enc"
KEY="$(basename "$ENC")"
FAIL_WHAT="$KEY"

# --- 2. where it goes --------------------------------------------------------------------
DEST="${BACKUP_OFFSITE_DEST:-}"
if [ -z "$DEST" ]; then
  echo "!! BACKUP_OFFSITE_DEST is not set, so every backup on this box sits on the disk it" >&2
  echo "   backs up. Nothing was copied." >&2
  echo "   Set it in $(pwd)/.env on the production VPS — the file cron reads through" >&2
  echo "   scripts/load-env.sh. Either:" >&2
  echo "     BACKUP_OFFSITE_DEST=s3://<bucket>/db   (+ BACKUP_S3_ACCESS_KEY_ID / _SECRET_ACCESS_KEY)" >&2
  echo "     BACKUP_OFFSITE_DEST=/mnt/<mount>       (a mount of a box that is not this one)" >&2
  if grep -qs '^BACKUP_OFFSITE_DEST=' .env; then
    echo "   NOTE: .env DOES set it and this process does not have it — the script was run" >&2
    echo "   without loading .env. Prefix:  . ./scripts/load-env.sh &&" >&2
  fi
  exit 2
fi

case "$DEST" in
  s3://*)
    SHAPE=s3
    rest="${DEST#s3://}"
    BUCKET="${rest%%/*}"
    PREFIX="${rest#"$BUCKET"}"
    PREFIX="${PREFIX#/}"
    PREFIX="${PREFIX%/}"
    # `db/` is the prefix backup-db.sh's own upload wrote to before D8, so the encrypted
    # copies land beside the plaintext ones they replace and one prune window covers both.
    # HD-9b: the AI web's dumps go BESIDE db/, never under it: s3-prune keeps BACKUP_KEEP per
    # prefix, and one shared prefix would halve the history of both.
    OBJ_PREFIX="${PREFIX:-db}"
    [ "$FAMILY" = aiweb ] && OBJ_PREFIX="$OBJ_PREFIX-aiweb"
    OBJECT="$OBJ_PREFIX/$KEY"
    [ -n "$BUCKET" ] || {
      echo "!! BACKUP_OFFSITE_DEST=$DEST names no bucket. Expected s3://bucket[/prefix]." >&2
      exit 2
    }
    # The credential gate. An absent credential is non-zero with nothing attempted, never a
    # silent skip: a destination that is configured but unusable is strictly worse than one
    # that is not configured, because the operator believes it works.
    for k in BACKUP_S3_ACCESS_KEY_ID BACKUP_S3_SECRET_ACCESS_KEY; do
      if [ -z "${!k:-}" ]; then
        echo "!! $k is not set, so the offsite copy of $KEY was NOT attempted." >&2
        echo "   It goes in $(pwd)/.env on the production VPS (read by cron through" >&2
        echo "   scripts/load-env.sh), next to BACKUP_OFFSITE_DEST. The key pair comes from" >&2
        echo "   the object-storage console of the provider that owns bucket '$BUCKET'; this" >&2
        echo "   repo cannot generate it and must not guess it. Never commit it." >&2
        exit 2
      fi
    done
    ;;
  *)
    SHAPE=dir
    [ -d "$DEST" ] || {
      echo "!! BACKUP_OFFSITE_DEST=$DEST is not a directory." >&2
      echo "   For the directory shape it must already be mounted — this script will not" >&2
      echo "   create it, because a typo'd path quietly becoming a new local directory is" >&2
      echo "   how an 'offsite' backup ends up on the same disk as its source." >&2
      exit 2
    }
    [ -w "$DEST" ] || {
      echo "!! $DEST is not writable by $(id -un 2>/dev/null || echo 'this user')." >&2
      exit 2
    }
    REMOTE="$DEST/$KEY"
    # The whole point of L2.7 is that the copy survives this filesystem dying. A
    # destination on the same device does not, however much it looks like a backup — so
    # it is refused unless somebody says out loud that they meant it. `stat -c %d` is the
    # device id, which is the thing a mount actually changes.
    if [ "${BACKUP_OFFSITE_ALLOW_SAME_FS:-}" != "1" ]; then
      src_dev="$(stat -c %d "$(dirname "$FILE")" 2>/dev/null || echo unknown)"
      dst_dev="$(stat -c %d "$DEST" 2>/dev/null || echo unknown)"
      if [ "$src_dev" = "$dst_dev" ] && [ "$src_dev" != unknown ]; then
        echo "!! $DEST is on the SAME filesystem (device $src_dev) as $FILE." >&2
        echo "   That copy dies with the original, which is the exact failure this script" >&2
        echo "   exists to prevent. Mount storage from another box, or set" >&2
        echo "   BACKUP_OFFSITE_ALLOW_SAME_FS=1 if a same-disk copy is genuinely meant." >&2
        exit 2
      fi
    fi
    ;;
esac

# --- 2b. what goes is the dump ENCRYPTED (D8) --------------------------------------------
# Made once per dump and reused after (the header says why it must be). --verify never makes
# one: no twin on this box means this dump never left it from here.
#
# openssl 3.0.2, the box's, exits 0 from `smime -encrypt -stream` on a full disk and leaves a
# TRUNCATED envelope. The read-back below compares what was sent with the twin, so a short twin
# would verify against itself. The twin is therefore checked whole, by itself, before anything
# is sent, every time it is made and every time it is reused: it must parse as DER to its end,
# be larger than its dump, and carry the sha256 of the dump it was made from (backup-db.sh
# used to write the final name directly, so a twin could belong to an older or cut-short dump).
DUMP_SHA="$(sha256_of "$FILE")"
SHAFILE="$ENC.sha256"
TWIN_WHY=''
twin_check() {
  local magic
  [ -s "$ENC" ] || { TWIN_WHY="is missing"; return 1; }
  # backup-env.sh's plaintext tripwire, for dumps: what goes must open as a PKCS#7 envelope (the
  # enveloped-data OID, 1.2.840.113549.1.7.3, is in its first bytes), never as gzip or SQL. It
  # catches the hurried fix that swaps the openssl line for a cp.
  magic="$(head -c 32 "$ENC" | od -An -tx1 | tr -d '[:space:]')"
  case "$magic" in
    *06092a864886f70d010703*) ;;
    *) TWIN_WHY="is not encrypted (it starts ${magic:0:8}, not a PKCS#7 envelope)"; return 1 ;;
  esac
  openssl asn1parse -inform DER -in "$ENC" >/dev/null 2>&1 \
    || { TWIN_WHY="is not a complete DER envelope (cut short?)"; return 1; }
  [ "$(wc -c <"$ENC" | tr -d ' ')" -gt "$(wc -c <"$FILE" | tr -d ' ')" ] \
    || { TWIN_WHY="is not larger than its dump (cut short?)"; return 1; }
  [ -s "$SHAFILE" ] && [ "$(tr -d '[:space:]' <"$SHAFILE")" = "$DUMP_SHA" ] \
    || { TWIN_WHY="was not made from $(basename "$FILE") as it is now (its dump sha256 is not recorded beside it, or differs)"; return 1; }
  return 0
}

make_twin() {
  local part
  part="$(dirname "$ENC")/.$KEY.part.$$"
  CLEANUP="$part"
  # -stream: one pass, the dump is never held whole. The only file written is ciphertext, here,
  # under a name no glob matches until it is complete; the plaintext is never copied anywhere.
  # ponytail: only the encrypting side streams. `openssl smime -decrypt`, on the owner's side,
  # holds the whole copy in memory. Dumps are a few MB; if one nears a GB, change the format
  # for both families (and DEPLOY.md) to one that decrypts as a stream.
  if ! openssl smime -encrypt -aes256 -binary -outform DER -stream -in "$FILE" -out "$part" "$CERT"; then
    rm -f "$part"; CLEANUP=''
    return 1
  fi
  rm -f "$ENC" "$SHAFILE"
  mv -f "$part" "$ENC"
  CLEANUP=''
  printf '%s\n' "$DUMP_SHA" >"$SHAFILE.part.$$" && mv -f "$SHAFILE.part.$$" "$SHAFILE"
}

if [ "$MODE" = copy ]; then
  # One run per family at a time (cron + somebody by hand): two runs could each make a twin and
  # send different ciphertexts to the two providers. Held until exit.
  if command -v flock >/dev/null 2>&1; then
    exec 9>"$(dirname "$ENC")/.offsite-$FAMILY.lock"
    flock -w 1800 9 || { echo "!! another backup-offsite.sh run held the lock for 30 minutes" >&2; exit 1; }
  fi
  # A twin lives exactly as long as its dump: those whose dump backup-db.sh or backup-aiweb-db.sh
  # has since pruned go too (with their recorded hash), or this directory would keep every
  # encrypted copy ever made. Only a twin whose dump is GONE is touched, and part files old
  # enough that no run can still be writing them.
  for twin in "$(dirname "$ENC")/$FAMILY"-*.sql.gz.enc; do
    [ -e "$twin" ] || continue
    [ -e "${twin%.enc}" ] || rm -f "$twin" "$twin.sha256" || true
  done
  for sha in "$(dirname "$ENC")/$FAMILY"-*.sql.gz.enc.sha256; do
    [ -e "$sha" ] || continue
    [ -e "${sha%.enc.sha256}" ] || rm -f "$sha" || true
  done
  find "$(dirname "$ENC")" -maxdepth 1 -type f -name ".$FAMILY-*.part*" -mmin +60 -delete 2>/dev/null || true
fi

if [ ! -s "$ENC" ] && [ "$MODE" = verify ]; then
  echo "!! $(basename "$FILE") has no encrypted twin ($KEY) on this box, so it has never been" >&2
  echo "   sent offsite from here. bash scripts/backup-offsite.sh makes it and sends it." >&2
  exit 1
fi
if ! twin_check; then
  if [ "$MODE" = verify ]; then
    echo "!! $ENC $TWIN_WHY, so nothing offsite can be compared with it." >&2
    echo "   --verify never makes one. bash scripts/backup-offsite.sh remakes it and sends it." >&2
    exit 1
  fi
  CERT="${BACKUP_ENV_CERT:-ops/env-backup-public.pem}"
  if [ ! -f "$CERT" ]; then
    echo "!! cannot encrypt $(basename "$FILE"): the certificate $CERT (BACKUP_ENV_CERT, default" >&2
    echo "   ops/env-backup-public.pem) is not a file here. Nothing was sent: a dump leaves this box" >&2
    echo "   encrypted or not at all (D8). Point BACKUP_ENV_CERT at the public half of the owner's" >&2
    echo "   key, or restore the committed one: git checkout -- ops/env-backup-public.pem" >&2
    exit 2
  fi
  [ -e "$ENC" ] && echo "offsite: $ENC $TWIN_WHY: deleting it and encrypting $(basename "$FILE") again" >&2
  # Twice at most: a twin that fails its own check straight after being made is retried once,
  # then it is a failure (a full disk, most likely), never a copy.
  attempt=0
  until make_twin && twin_check; do
    attempt=$((attempt + 1))
    rm -f "$ENC" "$SHAFILE"
    if [ "$attempt" -ge 2 ]; then
      echo "!! could not make a whole encrypted copy of $FILE ($TWIN_WHY) — disk full? Nothing was sent." >&2
      exit 1
    fi
  done
fi
LOCAL_SIZE="$(wc -c <"$ENC" | tr -d ' ')"
LOCAL_SHA="$(sha256_of "$ENC")"

# --- 3. read-back verification -----------------------------------------------------------
# Prints "<size> <sha256>" of what is ACTUALLY at the destination.
# 0 = read it, 3 = not there at all, 1 = could not tell.
#
# ponytail: the s3 shape streams the whole object back on every run. That is the only way
# "the bytes arrived" is a measurement rather than an assertion — a HeadObject size, or an
# ETag that stops being an MD5 the moment anything switches to multipart, proves less.
# Ceiling: one download of the dump per night (tens of MB, same datacentre, today). If
# dumps ever reach multiple GB, Head-verify nightly and full-verify weekly — and print
# which of the two ran, because a log that does not say is how this rots.
remote_probe() {
  case "$SHAPE" in
    dir)
      [ -f "$REMOTE" ] || return 3
      echo "$(wc -c <"$REMOTE" | tr -d ' ') $(sha256_of "$REMOTE")"
      ;;
    s3)
      # Credentials reach node through the environment only — never argv, which every user
      # on the box can read out of `ps`, and never stdout.
      S3_ENDPOINT="${BACKUP_S3_ENDPOINT:-https://nos.jkt-1.neo.id}" \
        S3_REGION="${BACKUP_S3_REGION:-jkt-1}" \
        S3_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY_ID" \
        S3_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_ACCESS_KEY" \
        node -e '
        const crypto = require("node:crypto");
        const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");
        const [bucket, key] = process.argv.slice(1);
        const client = new S3Client({
          endpoint: process.env.S3_ENDPOINT,
          region: process.env.S3_REGION,
          forcePathStyle: true,
          credentials: {
            accessKeyId: process.env.S3_ACCESS_KEY_ID,
            secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
          },
        });
        client
          .send(new GetObjectCommand({ Bucket: bucket, Key: key }))
          .then(async (res) => {
            // Hashed as it streams, so the size printed is the number of bytes this
            // process actually received — not a header claiming what it should have been.
            const hash = crypto.createHash("sha256");
            let n = 0;
            for await (const chunk of res.Body) {
              n += chunk.length;
              hash.update(chunk);
            }
            process.stdout.write(n + " " + hash.digest("hex") + "\n");
          })
          .catch((err) => {
            const name = (err && (err.name || err.Code)) || "unknown";
            const status = err && err.$metadata && err.$metadata.httpStatusCode;
            if (name === "NoSuchKey" || name === "NotFound" || status === 404) process.exit(3);
            // The error NAME only. A dumped SDK error carries the signed request it was
            // building, and a cron log is not the place to discover what that includes.
            console.error("s3 read-back failed: " + name + (status ? " (http " + status + ")" : ""));
            process.exit(1);
          });
      ' "$BUCKET" "$OBJECT"
      ;;
  esac
}

if [ "$SHAPE" = s3 ]; then
  TARGET_LABEL="s3://$BUCKET/$OBJECT"
else
  TARGET_LABEL="$REMOTE"
fi

# 0 verified, 3 absent, 1 present-but-wrong / unreadable.
#
# `|| rc=$?` rather than bracketing the call in `set +e` / `set -e`: `set -e` is global, not
# function-scoped, so re-enabling it in here re-enabled it for the CALLER too — and the very
# next `return 3` (the ordinary "not copied yet" answer) then killed the script before it
# could copy anything. The drill caught it: every copy case exited 3 having moved no bytes,
# and a nightly job that exits non-zero without copying is precisely the silent failure this
# file is about. Left of `||` is exempt from `set -e`, so nothing needs toggling at all.
verify_remote() {
  local out size sha rc=0
  out="$(remote_probe)" || rc=$?
  [ "$rc" -eq 3 ] && return 3
  if [ "$rc" -ne 0 ] || [ -z "$out" ]; then
    echo "!! could not read $TARGET_LABEL back" >&2
    return 1
  fi
  size="${out%% *}"
  sha="${out##* }"
  # Size first, so a truncated copy is reported as truncated instead of as a mystery hash
  # mismatch. Both are checked: a flipped byte keeps the size, and only the hash sees it.
  if [ "$size" != "$LOCAL_SIZE" ]; then
    echo "!! $TARGET_LABEL is ${size}B, the copy made here is ${LOCAL_SIZE}B — truncated copy." >&2
    return 1
  fi
  if [ "$sha" != "$LOCAL_SHA" ]; then
    echo "!! $TARGET_LABEL has the right size and the WRONG bytes." >&2
    echo "   local  sha256 $LOCAL_SHA" >&2
    echo "   remote sha256 $sha" >&2
    return 1
  fi
  return 0
}

# --- 4. copy, then prove it ---------------------------------------------------------------
echo "offsite: $KEY (${LOCAL_SIZE}B) -> $TARGET_LABEL"

verdict=0
verify_remote || verdict=$?

# Idempotent by construction, which is what makes it safe under cron: an already-correct
# object is verified and left alone, so a retry after a half-failed night costs one
# read-back and changes nothing.
if [ "$verdict" -eq 0 ]; then
  echo "ok — already offsite, verified by sha256 read-back ($LOCAL_SHA); encrypted from $(basename "$FILE"), sha256 $DUMP_SHA"
  exit 0
fi

if [ "$MODE" = verify ]; then
  [ "$verdict" -eq 3 ] && echo "!! $TARGET_LABEL does not exist — this dump is NOT offsite." >&2
  exit 1
fi

case "$SHAPE" in
  dir)
    # Land under a temp name and rename: a run interrupted mid-copy (cron kill, full disk,
    # unmounted share) must never leave a short file wearing the real name, because the
    # next run's verify would then be comparing against a plausible-looking lie.
    tmp="$DEST/.$KEY.part.$$"
    CLEANUP="$tmp"
    cp "$ENC" "$tmp"
    mv -f "$tmp" "$REMOTE"
    CLEANUP=''
    ;;
  s3)
    # The existing uploader, unchanged: it already does PutObject against NEO and it is the
    # one backup-env.sh calls. This script's contribution is the gate above and the proof
    # below, not a second implementation of PUT.
    S3_ENDPOINT="${BACKUP_S3_ENDPOINT:-https://nos.jkt-1.neo.id}" \
      S3_REGION="${BACKUP_S3_REGION:-jkt-1}" \
      S3_BUCKET="$BUCKET" \
      S3_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY_ID" \
      S3_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_ACCESS_KEY" \
      node scripts/upload-to-s3.mjs "$ENC" "$OBJECT"
    ;;
esac

verdict=0
verify_remote || verdict=$?

case "$verdict" in
  0) # Only after the copy is VERIFIED. Pruning before the read-back would trade a proven old
# copy for an unproven new one, which is the one trade a backup must never make.
#
# backup-db.sh:92 prunes the local disk to BACKUP_KEEP and its comment hands the remote side
# to somebody else — "NEO retention = set a lifecycle rule". Nobody did, so the bucket had no
# rule at all: it grew forever, and on the day the first copy landed it also held exactly one
# night of history. Same sentence, read at two different times.
# D8: the plaintext copies sent before it sort among the encrypted ones by their date (a
# <dump> key sorts just before its <dump>.enc), so they leave this window as the oldest, the
# way any copy does; nothing deletes them for being plaintext.
# BACKUP_SKIP_PRUNE=1 is for a destination whose key deliberately CANNOT delete (the second provider
# with a write-and-read-only key, BACKUP2_NO_DELETE=1): a ransomware-proof bucket is pruned by the
# provider's own lifecycle rule, and a prune attempt there would only fail every night in the log.
if [ "$SHAPE" = s3 ] && [ "${BACKUP_SKIP_PRUNE:-}" != 1 ]; then
  S3_ENDPOINT="${BACKUP_S3_ENDPOINT:-https://nos.jkt-1.neo.id}"     S3_REGION="${BACKUP_S3_REGION:-jkt-1}"     S3_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY_ID"     S3_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_ACCESS_KEY"     node scripts/s3-prune.mjs --bucket "$BUCKET" --prefix "$OBJ_PREFIX/"      --keep "${BACKUP_KEEP:-14}" || echo "!! offsite prune failed — the copy is safe, the bucket will grow" >&2
fi

echo "offsite OK — $TARGET_LABEL verified by read-back: ${LOCAL_SIZE}B, sha256 $LOCAL_SHA; encrypted from $(basename "$FILE"), sha256 $DUMP_SHA" ;;
  3)
    echo "!! the copy reported success and $TARGET_LABEL is not there." >&2
    exit 1
    ;;
  *) exit 1 ;;
esac
