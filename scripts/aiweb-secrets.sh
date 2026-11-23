#!/usr/bin/env bash
# HD-9: make, ON THIS BOX, the keys the AI web and auth-service's side of its sign-in need,
# for every one whose line is ABSENT from .env. scripts/deploy.sh runs it before it converges,
# so auth-service is recreated with any new key under that deploy's own health gate.
#
#   AIWEB_POSTGRES_PASSWORD  the AI web database's superuser (infra/aiweb/docker-compose.yml)
#   AIWEB_DB_OWNER_PASSWORD  ai_owner: owns database ai, runs the migrations
#   AIWEB_DB_APP_PASSWORD    ai_app: the app's role, row privileges only
#   AI_TOKEN_SIGNING_KEY     auth-service: signs the AI web's tokens (base64 PKCS8 DER, P-256)
#   TOTP_ENCRYPTION_KEY      auth-service: seals authenticator secrets (32 bytes, base64), made
#                            only while hydromart_auth holds no sealed secret at all (below)
#   AI_WEB_RETURN_URL        auth-service: AI_WEB_URL from infra/aiweb/docker-compose.yml plus
#                            /masuk/callback (not a secret; made here so the two cannot differ)
#
# AI-5, n8n's (infra/aiweb/docker-compose.yml, services n8n and n8n-setup):
#
#   AIWEB_N8N_DB_PASSWORD        role n8n, which owns database n8n (infra/aiweb/roles.sql)
#   AIWEB_N8N_ENCRYPTION_KEY     seals the credentials n8n stores. Made when the line is absent,
#                                like every key here, so never again once it exists: a new one
#                                opens none of what n8n sealed with the old one
#   AIWEB_N8N_TOKEN              between the AI web and n8n, both ways
#   AIWEB_N8N_MACHINE_ID         n8n's machine account at auth-service (a UUID, the token subject)
#   AIWEB_N8N_MACHINE_SECRET     its secret, and AIWEB_N8N_MACHINE_NOT_AFTER the day it stops
#   MACHINE_ACCOUNTS             auth-service: this script keeps n8n's entries in it, and only those
#
# A key whose line is PRESENT is left exactly as it is, blank included. A blank
# AI_TOKEN_SIGNING_KEY is the documented kill switch for AI tokens, and a deploy that filled it
# back in would undo it. A blank AIWEB_* password stops the AI web step, which says so.
#
# The machine secret is the one key made again on purpose: auth-service refuses a secret more than
# 90 days ahead (parseMachineAccounts), so it is ROTATED. When its line is absent, has no valid
# AIWEB_N8N_MACHINE_NOT_AFTER, or has fewer than 30 days left: a new secret, valid until today +
# 89 days (UTC), and MACHINE_ACCOUNTS rewritten to hold this id's entries that are still valid (the
# secret n8n holds until scripts/aiweb-deploy.sh gives it the new one, later in this deploy) plus
# the new one. Every other account's entry stays as it was. A BLANK secret is n8n's kill switch:
# this id's entries leave MACHINE_ACCOUNTS (auth refuses n8n from the converge that follows), the
# line stays blank, and the AI web step keeps n8n off. A MACHINE_ACCOUNTS that has lost the
# current secret's entry (overwritten by hand) gets it back. Nothing is written when the existing
# value does not parse, and n8n's entry, whose scope must be a capability of the release in this
# tree, is never written before that release has it: auth-service refuses to boot otherwise, and
# a rollback does not undo .env.
#
# TOTP_ENCRYPTION_KEY is the one key whose loss is data loss: every secret in
# totp_credentials is sealed with it, and a new key opens none of them. An absent line only means
# "no authenticator step", so when sealed secrets exist (their key went missing from .env) or
# cannot be counted, this writes NOTHING, says why with `!!` and exits non-zero (deploy.sh alerts
# once): the old key comes back from the .env backup, never a new one.
#
# Values are made with openssl, checked against the format auth-service validates at boot, and
# written through scripts/env-set.sh, the one writer of .env (it backs the file up, refuses a
# malformed line and keeps the file's mode). Nothing prints a value: only key names reach the
# log. Living in .env, they leave the box in the nightly encrypted backup (backup-env.sh). JSON is
# handled with the host's node, which the backup scripts already need.
#
# Exit: 0 nothing missing, or all of it written · non-zero nothing written.
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .env ] || {
  echo "aiweb-secrets: no .env in $PWD" >&2
  exit 1
}

# AIWEB_NODE exists for the self-test, which names a node that is not there: taking node off PATH
# is not reliable on a runner that has it in several directories. On the box it is node.
node_bin="${AIWEB_NODE:-node}"
if ! command -v "$node_bin" >/dev/null 2>&1; then
  echo "aiweb-secrets: !! this host has no node to read MACHINE_ACCOUNTS and check the keys the way auth-service reads them; nothing written" >&2
  exit 1
fi

absent() { ! grep -q "^$1=" .env; }
# A key's value as compose reads it: the last line wins, one layer of quotes off, no CR.
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

for key in AIWEB_POSTGRES_PASSWORD AIWEB_DB_OWNER_PASSWORD AIWEB_DB_APP_PASSWORD \
  AIWEB_N8N_DB_PASSWORD AIWEB_N8N_ENCRYPTION_KEY AIWEB_N8N_TOKEN; do
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
  # would then refuse to start, and a rollback does not undo .env. The reason a check fails is
  # printed (the parser's error code, never the key).
  if ! why="$(AIWEB_KEY="$signing" "$node_bin" -e '
    try {
      const key = require("node:crypto").createPrivateKey({
        key: Buffer.from(process.env.AIWEB_KEY, "base64"), format: "der", type: "pkcs8" });
      const curve = key.asymmetricKeyDetails && key.asymmetricKeyDetails.namedCurve;
      if (key.asymmetricKeyType !== "ec" || curve !== "prime256v1") {
        console.log("a " + key.asymmetricKeyType + " key on " + curve + ", not EC P-256");
        process.exit(1);
      }
    } catch (error) {
      console.log(error.code || error.message);
      process.exit(1);
    }
  ' 2>&1)"; then
    echo "aiweb-secrets: !! the AI_TOKEN_SIGNING_KEY just made is not what auth-service accepts ($why); nothing written" >&2
    exit 1
  fi
  add AI_TOKEN_SIGNING_KEY "$signing"
fi

if absent TOTP_ENCRYPTION_KEY; then
  # Counted read-only in hydromart's Postgres, through the container and role deploy.sh's probes
  # use. Anything but a clean 0 (rows, an error, an answer that is not a number) writes nothing.
  pg="${PG_CONTAINER:-hydromart-postgres}"
  if sealed="$(docker exec "$pg" psql -X -qtA -v ON_ERROR_STOP=1 -U hydromart -d hydromart_auth \
    -c 'BEGIN READ ONLY' -c 'SELECT count(*) FROM totp_credentials' -c 'ROLLBACK' 2>&1)"; then
    sealed="$(printf '%s' "$sealed" | tr -d '[:space:]')"
  else
    sealed="failed: $(printf '%s' "$sealed" | tr '\n' ' ' | cut -c1-200)"
  fi
  case "$sealed" in
    0) ;;
    '' | *[!0-9]*)
      echo "aiweb-secrets: !! TOTP_ENCRYPTION_KEY not made: could not count the sealed secrets in hydromart_auth.totp_credentials (${sealed:-no answer}); a new key over sealed secrets would be data loss; nothing written" >&2
      exit 1
      ;;
    *)
      echo "aiweb-secrets: !! TOTP_ENCRYPTION_KEY not made: hydromart_auth holds $sealed sealed authenticator secret(s) that only the old key opens. Put it back from the .env backup; nothing written" >&2
      exit 1
      ;;
  esac
  totp="$(openssl rand -base64 32)"
  # The rule auth-service applies at boot (infrastructure/security/totp.ts parseTotpKey).
  if ! [[ "$totp" =~ ^[A-Za-z0-9+/]{43}=$ ]]; then
    echo "aiweb-secrets: !! the TOTP_ENCRYPTION_KEY just made is not 32 bytes of base64; nothing written" >&2
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

# ------------------------------------------------------------- n8n's machine account (AI-5)
# The one capability n8n's token carries (hydromart-digital's crm route for a new franchise
# application, PR #1042).
SCOPE=franchiseApplicationNotify
if absent AIWEB_N8N_MACHINE_ID; then
  id="$("$node_bin" -e 'process.stdout.write(require("node:crypto").randomUUID())' 2>&1 || true)"
  add AIWEB_N8N_MACHINE_ID "$id"
else
  id="$(value AIWEB_N8N_MACHINE_ID)"
fi
secret="$(value AIWEB_N8N_MACHINE_SECRET)"
not_after="$(value AIWEB_N8N_MACHINE_NOT_AFTER)"
if absent AIWEB_N8N_MACHINE_SECRET; then
  mode=rotate
elif [ -z "${secret//[[:space:]]/}" ]; then
  mode=off
else
  # A date alone is 00:00 UTC that day, as auth-service reads it. Rotated from 30 days before it,
  # so the many deploys of a month all have the chance; anything not a plain date, or 90 days or
  # more ahead (auth-service refuses more than 90), is no date at all.
  mode=keep
  left=-1
  if [[ "$not_after" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] && day="$(date -u -d "$not_after" +%s 2>/dev/null)"; then
    left=$(((day - $(date -u +%s)) / 86400))
  fi
  if [ "$left" -lt 30 ] || [ "$left" -gt 89 ]; then mode=rotate; fi
fi
if [ "$mode" = rotate ]; then
  secret="$(openssl rand -hex 32)"
  not_after="$(date -u -d '+89 days' +%F)"
  add AIWEB_N8N_MACHINE_SECRET "$secret"
  add AIWEB_N8N_MACHINE_NOT_AFTER "$not_after"
fi

# MACHINE_ACCOUNTS: read as compose hands it to auth-service, rewritten only where n8n's entries
# change. The capability is looked up in the release this tree holds, which is what the converge
# after this script starts.
if [ "$(grep -c '^MACHINE_ACCOUNTS=' .env || true)" -gt 1 ]; then
  echo "aiweb-secrets: !! MACHINE_ACCOUNTS has more than one line in .env (compose reads the last); leave one; nothing written" >&2
  exit 1
fi
# The block is read whole before it is searched: with grep -q in a pipe, grep stops at the first
# match, sed can die of SIGPIPE, and pipefail would then call a present capability absent.
has_scope() {
  local block
  block="$(sed -n '/^export const CAPABILITIES = {/,/^}/p')"
  grep -q "^  $SCOPE:" <<<"$block"
}
capable=0
if has_scope 2>/dev/null <packages/access/src/index.ts; then capable=1; fi
# And in the release a failed gate rolls back to (deploy.sh's last good commit): rolled back with
# this .env, its auth-service must boot too. Unreadable (no such file, a commit git cannot show)
# is not held against it.
last_good="$(cat .deploy/last-good-sha 2>/dev/null || true)"
if [ "$capable" = 1 ] && [ -n "$last_good" ] &&
  previous="$(git show "$last_good:packages/access/src/index.ts" 2>/dev/null)" && ! has_scope <<<"$previous"; then
  capable=0
  echo "aiweb-secrets: the last good release ${last_good:0:12} has no capability $SCOPE: a rollback to it would not boot auth-service with n8n's entry" >&2
fi
rc=0
accounts="$(MA_RAW="$(value MACHINE_ACCOUNTS)" MA_ID="$id" MA_MODE="$mode" MA_SECRET="$secret" \
  MA_NOT_AFTER="$not_after" MA_SCOPE="$SCOPE" MA_CAPABLE="$capable" "$node_bin" -e '
  // Prints the new value (single-quoted for .env), exits 3 when nothing changes, 1 with the
  // reason when nothing may be written. Never prints a secret: entries hold its sha256 only.
  const e = process.env;
  const DAY = 86400000;
  const now = Date.now();
  const refuse = (why) => {
    console.log(why);
    process.exit(1);
  };
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(e.MA_ID)) {
    refuse("AIWEB_N8N_MACHINE_ID is not a lowercase UUID, so the n8n entries cannot be told apart");
  }
  let list;
  try {
    list = e.MA_RAW.trim() ? JSON.parse(e.MA_RAW) : [];
  } catch {
    list = null;
  }
  if (!Array.isArray(list) || list.some((a) => !a || typeof a !== "object" || Array.isArray(a))) {
    refuse("MACHINE_ACCOUNTS in .env is not a JSON list of accounts (auth-service would not boot on it either)");
  }
  // What auth-service accepts: not past its day and at most 90 days ahead (machineSecretLive).
  const live = (a) => {
    const t = Date.parse(a.notAfter);
    return t > now && t - now <= 90 * DAY;
  };
  const entry = () => ({
    id: e.MA_ID,
    name: "n8n",
    secretSha256: require("node:crypto").createHash("sha256").update(e.MA_SECRET).digest("hex"),
    scopes: [e.MA_SCOPE],
    notAfter: e.MA_NOT_AFTER,
  });
  const mine = list.filter((a) => a.id === e.MA_ID);
  let next = [];
  if (e.MA_MODE !== "off") {
    const current = entry();
    next = mine.some((a) => a.secretSha256 === current.secretSha256)
      ? mine
      : [...mine.filter(live), current];
  }
  // Every other entry where it was, the kept n8n ones too; a new one last.
  const out = [...list.filter((a) => a.id !== e.MA_ID || next.includes(a)), ...next.filter((a) => !list.includes(a))];
  if (JSON.stringify(out) === JSON.stringify(list)) process.exit(3);
  for (const a of next.filter((n) => !list.includes(n))) {
    if (e.MA_CAPABLE !== "1") {
      refuse("the release in this tree, or the last good one a rollback returns to, has no capability " + e.MA_SCOPE + " (hydromart-digital PR #1042): auth-service would refuse to boot with the n8n entry, so MACHINE_ACCOUNTS was not changed");
    }
    if (!live(a)) refuse("the new n8n entry ends " + a.notAfter + ", not within the 90 days auth-service allows");
  }
  const pairs = new Set(out.map((a) => a.id + ":" + a.secretSha256));
  if (pairs.size !== out.length) refuse("MACHINE_ACCOUNTS would list one id with one secret twice, which auth-service refuses");
  const text = out.length > 0 ? JSON.stringify(out) : "";
  // Single-quoted in .env, so compose takes the JSON as it is (the quote is char 39: this
  // script sits inside a single-quoted shell string).
  const q = String.fromCharCode(39);
  if (text.includes(q)) refuse("MACHINE_ACCOUNTS holds a single quote, so it cannot be single-quoted in .env");
  process.stdout.write(text ? q + text + q : "");
' 2>&1)" || rc=$?
case "$rc" in
  # Empty, or one single-quoted JSON list on one line: anything else is not this script's answer.
  0)
    case "$accounts" in
      "" | "'["*"]'") add MACHINE_ACCOUNTS "$accounts" ;;
      *)
        echo "aiweb-secrets: !! reading MACHINE_ACCOUNTS gave an answer that is not a JSON list; nothing written" >&2
        exit 1
        ;;
    esac
    ;;
  3) ;;
  *)
    echo "aiweb-secrets: !! $accounts; nothing written" >&2
    exit 1
    ;;
esac
case "$mode" in
  off) echo "aiweb-secrets: AIWEB_N8N_MACHINE_SECRET is blank (n8n's kill switch): n8n has no entry in MACHINE_ACCOUNTS" ;;
  rotate) echo "aiweb-secrets: n8n's machine secret made anew, valid until $not_after; its entry in MACHINE_ACCOUNTS beside any still valid" ;;
esac

if [ -z "$BLOCK" ]; then
  echo "aiweb-secrets: nothing missing"
  exit 0
fi
echo "aiweb-secrets: making on this box:$NAMES"
# ENV_SET_BLOCK passed EXPLICITLY. deploy.yml hands its SSH step the repo secret of that name in
# every mode, the deploy included, and env-set.sh prefers it to stdin: inherited, it would apply
# whatever that secret last held instead of this block.
ENV_SET_BLOCK="$BLOCK" bash scripts/env-set.sh
