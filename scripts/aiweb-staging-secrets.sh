#!/usr/bin/env bash
# D3 staging: make, ON THIS BOX, the keys the staging AI web needs (infra/aiweb-staging/), for
# every one whose line is ABSENT from .env, the way scripts/aiweb-secrets.sh does for the
# production AI web. scripts/deploy.sh runs it before scripts/aiweb-staging-deploy.sh.
#
#   STAGING_POSTGRES_PASSWORD, STAGING_DB_OWNER_PASSWORD, STAGING_DB_APP_PASSWORD
#                           the staging database's three roles
#   STAGING_N8N_DB_PASSWORD, STAGING_N8N_ENCRYPTION_KEY, STAGING_N8N_TOKEN
#                           n8n's database role, the key it seals credentials with, and the token
#                           the staging app and n8n share
#   STAGING_HD_EVENT_SECRET the secret the fake hydromart signs its events with
#   STAGING_N8N_MACHINE_ID  (a UUID) and STAGING_N8N_MACHINE_SECRET: n8n's machine account, known
#                           only to the fake hydromart (never rotated, never in MACHINE_ACCOUNTS)
#   STAGING_MOCK_SIGNING_KEY the fake hydromart's token key (EC P-256, PKCS8 DER, base64)
#
# Every value is new: made with openssl here, never copied from or derived from a production key.
# And the refusal this script exists for: when ANY staging value (made now or already in .env,
# hand-set included) equals a production AI web value (AIWEB_*), or the mock's signing key is the
# SAME KEY as production's AI_TOKEN_SIGNING_KEY (compared as decoded key material, not as text),
# nothing is written, `!!` says which key, and the exit is non-zero: a staging token that
# production's AI web would accept is exactly what staging must never have.
#
# A key whose line is PRESENT is left exactly as it is. Nothing prints a value: only key names reach
# the log. The values are written through scripts/env-set.sh, the one writer of .env, and travel
# in the nightly encrypted .env backup (synthetic: harmless). Not made here: STAGING_AI_BASIC_AUTH_HASH,
# which scripts/aiweb-staging-deploy.sh writes from the STAGING_AI_PASSWORD repo secret.
#
# Exit: 0 nothing missing, or all of it written · non-zero nothing written.
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .env ] || {
  echo "aiweb-staging-secrets: no .env in $PWD" >&2
  exit 1
}
node_bin="${AIWEB_NODE:-node}"
if ! command -v "$node_bin" >/dev/null 2>&1; then
  echo "aiweb-staging-secrets: !! this host has no node to check the signing key; nothing written" >&2
  exit 1
fi

absent() { ! grep -q "^$1=" .env; }
value() {
  local v
  v="$(tr -d '\r' < .env | sed -n "s/^$1=//p" | tail -1)"
  case "$v" in
    \"*\") v="${v#\"}" && v="${v%\"}" ;;
    \'*\') v="${v#\'}" && v="${v%\'}" ;;
  esac
  printf '%s' "$v"
}
BLOCK=''
NAMES=''
add() {
  BLOCK+="$1=$2"$'\n'
  NAMES+=" $1"
}
# A decision made on the values AFTER this script's own: kept here so the refusal sees them.
declare -A NEW=()

for key in STAGING_POSTGRES_PASSWORD STAGING_DB_OWNER_PASSWORD STAGING_DB_APP_PASSWORD \
  STAGING_N8N_DB_PASSWORD STAGING_N8N_ENCRYPTION_KEY STAGING_N8N_TOKEN STAGING_HD_EVENT_SECRET \
  STAGING_N8N_MACHINE_SECRET; do
  if absent "$key"; then
    NEW[$key]="$(openssl rand -hex 32)"
    add "$key" "${NEW[$key]}"
  fi
done
if absent STAGING_N8N_MACHINE_ID; then
  NEW[STAGING_N8N_MACHINE_ID]="$("$node_bin" -e 'process.stdout.write(require("node:crypto").randomUUID())')"
  add STAGING_N8N_MACHINE_ID "${NEW[STAGING_N8N_MACHINE_ID]}"
fi
if absent STAGING_MOCK_SIGNING_KEY; then
  # Through `pkcs8 -topk8`: `genpkey -outform DER` alone writes the SEC1 form for an EC key.
  signing="$(openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 |
    openssl pkcs8 -topk8 -nocrypt -outform DER | base64 -w0)"
  NEW[STAGING_MOCK_SIGNING_KEY]="$signing"
  add STAGING_MOCK_SIGNING_KEY "$signing"
fi

# ---------------------------------------------------------------------------- the refusals
# Every STAGING_* secret that will exist (the line in .env, or the value about to be written)
# against every production AI web secret. The values go to node through the environment, never an
# argument, and node prints key names only.
refusal=''
if ! refusal="$(
  for k in STAGING_POSTGRES_PASSWORD STAGING_DB_OWNER_PASSWORD STAGING_DB_APP_PASSWORD \
    STAGING_N8N_DB_PASSWORD STAGING_N8N_ENCRYPTION_KEY STAGING_N8N_TOKEN STAGING_HD_EVENT_SECRET \
    STAGING_N8N_MACHINE_SECRET STAGING_MOCK_SIGNING_KEY; do
    if [ -n "${NEW[$k]+x}" ]; then export "SK_$k=${NEW[$k]}"; else export "SK_$k=$(value "$k")"; fi
  done
  for k in AIWEB_POSTGRES_PASSWORD AIWEB_DB_OWNER_PASSWORD AIWEB_DB_APP_PASSWORD AIWEB_N8N_DB_PASSWORD \
    AIWEB_N8N_ENCRYPTION_KEY AIWEB_N8N_TOKEN AIWEB_N8N_MACHINE_SECRET AIWEB_HD_EVENT_SECRET \
    AIWEB_HD_EVENT_SECRET_NEXT AI_TOKEN_SIGNING_KEY; do
    export "PK_$k=$(value "$k")"
  done
  "$node_bin" -e '
    const { createPrivateKey, createPublicKey } = require("node:crypto");
    const e = process.env;
    const staging = Object.keys(e).filter((k) => k.startsWith("SK_")).map((k) => [k.slice(3), e[k]]);
    const prod = Object.keys(e).filter((k) => k.startsWith("PK_")).map((k) => [k.slice(3), e[k]]);
    const bad = [];
    for (const [sk, sv] of staging) {
      if (!sv) continue;
      for (const [pk, pv] of prod) if (pv && sv === pv) bad.push(sk + " equals " + pk);
    }
    // Key material, whatever the text: the same private or public key, in any encoding of it.
    const spki = (b64) => {
      try {
        const k = createPrivateKey({ key: Buffer.from(b64, "base64"), format: "der", type: "pkcs8" });
        return createPublicKey(k).export({ type: "spki", format: "der" }).toString("base64");
      } catch {
        return null;
      }
    };
    const mine = e.SK_STAGING_MOCK_SIGNING_KEY ? spki(e.SK_STAGING_MOCK_SIGNING_KEY) : null;
    const theirs = e.PK_AI_TOKEN_SIGNING_KEY ? spki(e.PK_AI_TOKEN_SIGNING_KEY) : null;
    if (e.SK_STAGING_MOCK_SIGNING_KEY && mine === null) bad.push("STAGING_MOCK_SIGNING_KEY is not an EC PKCS8 DER key");
    if (mine && theirs && mine === theirs) bad.push("STAGING_MOCK_SIGNING_KEY is the same key as AI_TOKEN_SIGNING_KEY");
    if (bad.length) {
      console.log(bad.join("; "));
      process.exit(1);
    }
  ' 2>&1
)"; then
  echo "aiweb-staging-secrets: !! ${refusal:-the check could not run}; nothing written" >&2
  exit 1
fi

if [ -z "$BLOCK" ]; then
  echo "aiweb-staging-secrets: nothing missing"
  exit 0
fi
echo "aiweb-staging-secrets: making on this box:$NAMES"
# ENV_SET_BLOCK passed EXPLICITLY: deploy.yml hands its SSH step the repo secret of that name in
# every mode, and env-set.sh prefers it to stdin.
ENV_SET_BLOCK="$BLOCK" bash scripts/env-set.sh
