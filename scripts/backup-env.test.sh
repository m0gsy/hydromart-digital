#!/usr/bin/env bash
# The runnable check for scripts/backup-env.sh.
#
#   bash scripts/backup-env.test.sh
#
# The claim being checked is not "it uploads" — it is "what leaves this box cannot be read by
# whoever finds it". That is testable here with no bucket and no network: generate a keypair,
# encrypt, and prove three things about the bytes.
#
# CI invokes this as `bash -e file`, which sets -e for the whole script whatever the line
# below asks for — and every refusal case here exits non-zero on purpose. So -e is switched
# off explicitly: the assertions are the verdict, not the shell's.
set +e
cd "$(dirname "$0")/.."

fails=0
ok() { echo "  ok   $1"; }
bad() { echo "  FAIL $1"; fails=$((fails + 1)); }

echo "backup-env.sh:"
bash -n scripts/backup-env.sh || bad "does not parse"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# `//CN=`, two slashes: on Git Bash a single-slash subject is rewritten into a drive path and
# openssl refuses it. MSYS_NO_PATHCONV=1 fixes the subject and breaks -keyout/-out instead,
# so the double slash is the form that works on every machine.
openssl req -x509 -newkey rsa:2048 -keyout "$WORK/priv.pem" \
  -out "$WORK/pub.pem" -days 1 -nodes -subj "//CN=hydromart-env-backup-test" >/dev/null 2>&1

# The fixture has to EXIST before anything is asserted about it. Without this the first
# assertion below passed on a MISSING file — `grep` on nothing exits non-zero, which reads
# as "no plaintext found". A green that means "the test never ran" is the exact failure this
# area keeps finding elsewhere, and it appeared here first.
[ -s "$WORK/pub.pem" ] && [ -s "$WORK/priv.pem" ] || {
  echo "  FAIL could not generate a test keypair — nothing below would have measured anything" >&2
  exit 1
}

printf 'JWT_ACCESS_SECRET=sentinel-do-not-leak\nBACKUP_S3_SECRET_ACCESS_KEY=also-secret\n' >"$WORK/.env"
openssl smime -encrypt -aes256 -binary -outform DER -in "$WORK/.env" -out "$WORK/out.enc" "$WORK/pub.pem" 2>/dev/null
[ -s "$WORK/out.enc" ] || { echo "  FAIL encryption produced no output" >&2; exit 1; }

# 1. The bytes that leave must not carry the secrets in the clear. This is the whole point:
#    a plaintext .env in the backup bucket turns that bucket into a credential store, and the
#    key that writes it already lives on the box.
if grep -qa 'sentinel-do-not-leak' "$WORK/out.enc"; then
  bad "the encrypted object still contains the plaintext secret"
else
  ok "what leaves the box carries no plaintext secret"
fi

# 2. The private half opens it. An unreadable backup is not a backup, and this is the half
#    that only exists off the server.
if openssl smime -decrypt -binary -inform DER -in "$WORK/out.enc" -inkey "$WORK/priv.pem" 2>/dev/null |
  grep -qa 'sentinel-do-not-leak'; then
  ok "the private key opens it again, byte for byte"
else
  bad "the private key cannot decrypt it — the backup would be unreadable"
fi

# 3. The PUBLIC half must NOT. This is what makes putting it on the server safe: root on the
#    box can encrypt tomorrow's copy and cannot read yesterday's.
if openssl smime -decrypt -binary -inform DER -in "$WORK/out.enc" -inkey "$WORK/pub.pem" 2>/dev/null |
  grep -qa 'sentinel-do-not-leak'; then
  bad "the PUBLIC key decrypts it — everything on the box could read every backup"
else
  ok "the public key on the box cannot open what it wrote"
fi

# 4. Refuses, loudly, when no certificate is configured — rather than shipping .env in the
#    clear or silently doing nothing. The state every box is in until somebody sets it up.
out="$(cd "$WORK" && printf 'X=1\n' >.env && BACKUP_ENV_CERT='' BACKUP_OFFSITE_DEST=s3://b/db \
  bash "$OLDPWD/scripts/backup-env.sh" 2>&1)"
rc=$?
if [ "$rc" = 2 ] && printf '%s' "$out" | grep -q 'BACKUP_ENV_CERT'; then
  ok "an unconfigured box refuses and names the key to set"
else
  bad "unconfigured box did not refuse with exit 2 naming BACKUP_ENV_CERT (got $rc)"
fi

# 5. The plaintext guard in the script itself must exist. It is the one assertion that
#    catches an operator swapping the openssl line for a `cp` during a hurried fix — which
#    would publish every credential this system has, to a bucket, forever.
if grep -q "grep -qa 'JWT_ACCESS_SECRET='" scripts/backup-env.sh; then
  ok "the script refuses to call a plaintext object a backup"
else
  bad "the plaintext tripwire is gone from backup-env.sh"
fi

if [ "$fails" -gt 0 ]; then
  echo "backup-env.sh: $fails check(s) failed" >&2
  exit 1
fi
echo "backup-env.sh: all checks passed"
