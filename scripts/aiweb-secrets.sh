#!/usr/bin/env bash
# HD-9: make, ON THIS BOX, the keys the AI web and auth-service's side of its sign-in need,
# for every one whose line is ABSENT from .env. scripts/deploy.sh runs it before it converges,
# so auth-service is recreated with any new key under that deploy's own health gate.
#
#   AIWEB_POSTGRES_PASSWORD  the AI web database's superuser (infra/aiweb/docker-compose.yml)
#   AIWEB_DB_OWNER_PASSWORD  ai_owner: owns database ai, runs the migrations
#   AIWEB_DB_APP_PASSWORD    ai_app: the app's role, row privileges only
#   AI_TOKEN_SIGNING_KEY     auth-service: signs the AI web's tokens (base64 PKCS8 DER, P-256)
#   TOTP_ENCRYPTION_KEY      auth-service: seals authenticator secrets (32 bytes, base64)
#   AI_WEB_RETURN_URL        auth-service: AI_WEB_URL from infra/aiweb/docker-compose.yml plus
#                            /masuk/callback (not a secret; made here so the two cannot differ)
#
# A key whose line is PRESENT is left exactly as it is, blank included. A blank
# AI_TOKEN_SIGNING_KEY is the documented kill switch for AI tokens, and a deploy that filled it
# back in would undo it. A blank AIWEB_* password stops the AI web step, which says so.
#
# Values are made with openssl, checked against the format auth-service validates at boot, and
# written through scripts/env-set.sh, the one writer of .env (it backs the file up, refuses a
# malformed line and keeps the file's mode). Nothing prints a value: only key names reach the
# log. Living in .env, they leave the box in the nightly encrypted backup (backup-env.sh).
#
# Exit: 0 nothing missing, or all of it written · non-zero nothing written.
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .env ] || {
  echo "aiweb-secrets: no .env in $PWD" >&2
  exit 1
}

absent() { ! grep -q "^$1=" .env; }
BLOCK=''
NAMES=''
add() {
  BLOCK+="$1=$2"$'\n'
  NAMES+=" $1"
}

for key in AIWEB_POSTGRES_PASSWORD AIWEB_DB_OWNER_PASSWORD AIWEB_DB_APP_PASSWORD; do
  # Hex, so a password needs no escaping inside a DATABASE_URL.
  if absent "$key"; then add "$key" "$(openssl rand -hex 32)"; fi
done

if absent AI_TOKEN_SIGNING_KEY; then
  # One line, not a PEM: a PEM's real newlines are what env-doctor.sh exists to repair. Through
  # `pkcs8 -topk8`: `genpkey -outform DER` alone writes the 121-byte SEC1 form for an EC key
  # (OpenSSL 3.0.2 on the box and 3.5 alike), which auth-service refuses at boot.
  signing="$(openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 |
    openssl pkcs8 -topk8 -nocrypt -outform DER | base64 -w0)"
  # Read back exactly as auth-service reads it at boot (external-access.ts parseSigningKey),
  # with the host's Node: a key it would refuse must never reach .env, because auth-service
  # would then refuse to start, and a rollback does not undo .env.
  if ! AIWEB_KEY="$signing" node -e '
    const key = require("node:crypto").createPrivateKey({
      key: Buffer.from(process.env.AIWEB_KEY, "base64"), format: "der", type: "pkcs8" });
    process.exit(key.asymmetricKeyType === "ec" && key.asymmetricKeyDetails?.namedCurve === "prime256v1" ? 0 : 1);
  ' 2>/dev/null; then
    echo "aiweb-secrets: the AI_TOKEN_SIGNING_KEY just made is not what auth-service accepts; nothing written" >&2
    exit 1
  fi
  add AI_TOKEN_SIGNING_KEY "$signing"
fi

if absent TOTP_ENCRYPTION_KEY; then
  totp="$(openssl rand -base64 32)"
  # The rule auth-service applies at boot (infrastructure/security/totp.ts parseTotpKey).
  if ! [[ "$totp" =~ ^[A-Za-z0-9+/]{43}=$ ]]; then
    echo "aiweb-secrets: the TOTP_ENCRYPTION_KEY just made is not 32 bytes of base64; nothing written" >&2
    exit 1
  fi
  add TOTP_ENCRYPTION_KEY "$totp"
fi

if absent AI_WEB_RETURN_URL; then
  origin="$(sed -n 's/^ *AI_WEB_URL: *//p' infra/aiweb/docker-compose.yml | head -1 | tr -d "\"' \r")"
  case "$origin" in
    https://*[!/]) add AI_WEB_RETURN_URL "$origin/masuk/callback" ;;
    *)
      echo "aiweb-secrets: infra/aiweb/docker-compose.yml has no https AI_WEB_URL origin; nothing written" >&2
      exit 1
      ;;
  esac
fi

if [ -z "$BLOCK" ]; then
  echo "aiweb-secrets: nothing missing"
  exit 0
fi
echo "aiweb-secrets: making on this box:$NAMES"
# ENV_SET_BLOCK passed EXPLICITLY. deploy.yml hands its SSH step the repo secret of that name in
# every mode, the deploy included, and env-set.sh prefers it to stdin: inherited, it would apply
# whatever that secret last held instead of this block.
ENV_SET_BLOCK="$BLOCK" bash scripts/env-set.sh
