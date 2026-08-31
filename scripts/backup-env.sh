#!/usr/bin/env bash
# Get the CONFIGURATION off the box too, and encrypted, because it is all credentials.
#
# `scripts/backup-offsite.sh` copies the database. A database is not a system: restored onto
# a fresh box it will not start, because `.env` holds the 68 keys that tell it what it is —
# database URLs, JWT secrets, S3 credentials, the OTP provider, every Sentry DSN. Measured on
# production 2026-08-31: 7,925 bytes, 68 keys, and the only copy of it lives on the box it
# describes. Lose that box and the dumps are a pile of rows nobody can serve.
#
# The obvious fix is the wrong one. Copying `.env` into the backup bucket in the clear turns
# that bucket into a credential store, and the key that writes it is already ON the box — so
# whatever reaches the box reaches every secret it has, in one file, forever.
#
# So: ASYMMETRIC. The box holds a PUBLIC certificate and can only ENCRYPT. The private half
# never touches this machine, which is the whole point — an attacker with root here gets a
# blob they cannot open, and the operator with the private key can open it from anywhere.
#
#   bash scripts/backup-env.sh              # encrypt .env and copy it off-box
#   bash scripts/backup-env.sh --verify     # read the newest one back, never uploads
#
# ONE-TIME SETUP, on a machine that is NOT the server:
#
#   openssl req -x509 -newkey rsa:4096 -keyout hydromart-env-private.pem \
#     -out hydromart-env-public.pem -days 3650 -nodes -subj "//CN=hydromart-env-backup"
#
# The subject is written `//CN=` with TWO slashes on purpose. On Git Bash — the machine most
# likely to be holding the private key — MSYS rewrites a single-slash `/CN=...` into a drive
# path and openssl refuses it with "subject name is expected to be in the format ...". The
# double slash is left alone by MSYS and read identically by openssl everywhere else.
# (`MSYS_NO_PATHCONV=1` fixes the subject and breaks the -keyout/-out paths instead, which is
# how this was measured.)
#
# Keep `hydromart-env-private.pem` somewhere that survives losing the server — a password
# manager, a printed QR, another cloud. Put ONLY the public half on the box and point
# BACKUP_ENV_CERT at it. To read a backup later:
#
#   openssl smime -decrypt -binary -inform DER -in env-2026-08-31.enc \
#     -inkey hydromart-env-private.pem
#
# Env:
#   BACKUP_ENV_CERT       REQUIRED. Path to the PUBLIC pem on this box.
#   BACKUP_OFFSITE_DEST   REQUIRED. Reused from backup-offsite.sh — same bucket, `env/` prefix.
#   BACKUP_S3_*           Reused. The same credentials, deliberately: a second key pair would
#                         be a second thing to rotate and a second thing to forget.
#
# Exit: 0 verified · 1 not verifiable (the loud one) · 2 not configured.
set -euo pipefail

cd "$(dirname "$0")/.."
# shellcheck source=scripts/lib/deploy-common.sh
. ./scripts/lib/deploy-common.sh

# The alert trap goes up here, before the first exit that means "no copy left the box
# tonight" — the same lesson backup-offsite.sh paid for: its trap sat below the destination
# check, so the most likely failure on a fresh box exited non-zero in silence.
FAIL_WHAT='the .env backup'
trap 'rc=$?; [ "$rc" -ne 0 ] && alert "$FAIL_WHAT FAILED (exit $rc) — the configuration for this box exists nowhere else"; exit $rc' EXIT

MODE=copy
[ "${1:-}" = "--verify" ] && MODE=verify

[ -f .env ] || { echo "!! no .env in $PWD — nothing to back up" >&2; exit 2; }

CERT="${BACKUP_ENV_CERT:-}"
if [ -z "$CERT" ] || [ ! -f "$CERT" ]; then
  echo "!! BACKUP_ENV_CERT is not set to a readable public certificate, so the configuration" >&2
  echo "   for this box exists in exactly one place: this box." >&2
  echo "   Generate a keypair OFF this machine and copy only the public half here:" >&2
  echo "     openssl req -x509 -newkey rsa:4096 -keyout PRIVATE.pem -out PUBLIC.pem \\" >&2
  echo "       -days 3650 -nodes -subj \"/CN=hydromart-env-backup\"" >&2
  echo "   Then set BACKUP_ENV_CERT=/path/to/PUBLIC.pem in .env." >&2
  exit 2
fi

DEST="${BACKUP_OFFSITE_DEST:-}"
[ -n "$DEST" ] || { echo "!! BACKUP_OFFSITE_DEST is not set — see scripts/backup-offsite.sh --help" >&2; exit 2; }
case "$DEST" in
  s3://*) ;;
  *) echo "!! backup-env only supports an s3:// destination; got $DEST" >&2; exit 2 ;;
esac
rest="${DEST#s3://}"
BUCKET="${rest%%/*}"
KEY="env-$(date +%Y-%m-%d).enc"
OBJECT="env/$KEY"
FAIL_WHAT="$KEY"

s3() {
  S3_ENDPOINT="${BACKUP_S3_ENDPOINT:-https://nos.jkt-1.neo.id}" \
    S3_REGION="${BACKUP_S3_REGION:-jkt-1}" \
    S3_BUCKET="$BUCKET" \
    S3_ACCESS_KEY_ID="${BACKUP_S3_ACCESS_KEY_ID:-}" \
    S3_SECRET_ACCESS_KEY="${BACKUP_S3_SECRET_ACCESS_KEY:-}" \
    "$@"
}

TMP="$(mktemp -d)"
trap 'rc=$?; rm -rf "$TMP"; [ "$rc" -ne 0 ] && alert "$FAIL_WHAT FAILED (exit $rc) — the configuration for this box exists nowhere else"; exit $rc' EXIT

# DER, not PEM: the object is bytes to be diffed and read back, and base64 armour would make
# a byte comparison compare the armour rather than the payload.
openssl smime -encrypt -aes256 -binary -outform DER -in .env -out "$TMP/$KEY" "$CERT"
LOCAL_SHA="$(sha256sum "$TMP/$KEY" | cut -d' ' -f1)"

if [ "$MODE" = copy ]; then
  s3 node scripts/upload-to-s3.mjs "$TMP/$KEY" "$OBJECT"
fi

# Read it BACK. An upload that returned 200 is a claim about one HTTP request; this is a
# claim about the bytes now in the bucket — the same rule backup-offsite.sh follows, and the
# reason it exists rather than trusting the uploader's exit code.
# Read-back, reusing the shape backup-offsite.sh already proved: hashed as it STREAMS, so
# the size is what this process received rather than a header claiming what it should be.
# Credentials reach node through the environment only — never argv, which every user on the
# box can read out of `ps`.
read_back() {
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
}

if ! REMOTE_OUT="$(read_back "$BUCKET" "$OBJECT")"; then
  echo "!! could not read s3://$BUCKET/$OBJECT back — this configuration is NOT offsite." >&2
  exit 1
fi
REMOTE_SHA="${REMOTE_OUT##* }"
if [ "$REMOTE_SHA" != "$LOCAL_SHA" ]; then
  echo "!! s3://$BUCKET/$OBJECT does not match what was encrypted here." >&2
  echo "   local  $LOCAL_SHA" >&2
  echo "   remote $REMOTE_SHA" >&2
  exit 1
fi

# Proof it is really encrypted, not a plaintext file with a .enc name. Cheap, and the failure
# it catches — an operator swapping the openssl line for a cp during a hurried fix — would
# otherwise publish every credential this system has.
if grep -qa 'JWT_ACCESS_SECRET=' "$TMP/$KEY"; then
  echo "!! the object read back contains PLAINTEXT keys. Refusing to call this a backup." >&2
  exit 1
fi

# Same window as the dumps, and for the same reason: a bucket with no rule grows forever.
# Only after the read-back proved this copy is good.
if [ "$MODE" = copy ]; then
  s3 node scripts/s3-prune.mjs --bucket "$BUCKET" --prefix env/     --keep "${BACKUP_KEEP:-14}" || echo "!! env prune failed — the copy is safe, the bucket will grow" >&2
fi

echo "env OK — s3://$BUCKET/$OBJECT verified by read-back: $(wc -c <"$TMP/$KEY" | tr -d ' ')B, sha256 $LOCAL_SHA"
echo "   Decrypt with: openssl smime -decrypt -binary -inform DER -in $KEY -inkey PRIVATE.pem"
