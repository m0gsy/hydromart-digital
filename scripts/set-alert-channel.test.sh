#!/usr/bin/env bash
# The runnable check for scripts/set-alert-channel.sh.
#
#   bash scripts/set-alert-channel.test.sh
#
# It writes a webhook URL — a secret — into a file that a container reads, on the one box there is.
# The properties that matter are exercised against a throwaway tree and a stand-in for curl: it
# refuses what is not a webhook, never prints the URL, appends Discord's /slack once, rewrites the
# file IN PLACE (a bind mount replaced by rename keeps the old content), and reports a test message
# that did not arrive.
set -uo pipefail
# CI invokes this as `bash -e file`; the negative cases below are SUPPOSED to exit non-zero.
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

mkdir -p "$WORK/repo/scripts" "$WORK/bin"
cp scripts/set-alert-channel.sh "$WORK/repo/scripts/"
cat > "$WORK/bin/curl" <<'SH'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$SENT"
[ "${CURL_FAILS:-}" = 1 ] && exit 22
exit 0
SH
chmod +x "$WORK/bin/curl"
export PATH="$WORK/bin:$PATH" SENT="$WORK/sent"

DISCORD='https://discord.com/api/webhooks/123456789/AbCdEfSecretTokenValue'
run() { (cd "$WORK/repo" && bash scripts/set-alert-channel.sh "$@") > "$WORK/out" 2>&1; RC=$?; }
FILE="$WORK/repo/ops/alertmanager-secondary/webhook-url"

echo "second alert channel:"

unset ALERT_WEBHOOK_URL_2
run
[ "$RC" = 2 ] && [ ! -e "$FILE" ] && ok "no URL set: exit 2, nothing written" || bad "an unset URL must refuse (rc=$RC)"

ALERT_WEBHOOK_URL_2='https://evil.example.com/hook' run
[ "$RC" = 2 ] && [ ! -e "$FILE" ] && ok "a URL that is not a Discord/Slack webhook is refused, nothing written" || bad "a foreign URL must refuse (rc=$RC)"

ALERT_WEBHOOK_URL_2="$DISCORD" run
[ "$RC" = 0 ] && [ "$(cat "$FILE")" = "$DISCORD/slack" ] && ok "a Discord URL is written with the /slack suffix (Alertmanager speaks Slack payloads)" || bad "the Discord URL should get /slack (rc=$RC): $(cat "$FILE" 2>/dev/null)"

ALERT_WEBHOOK_URL_2="$DISCORD/slack" run
[ "$(cat "$FILE")" = "$DISCORD/slack" ] && ok "/slack is appended once, not twice" || bad "the suffix was doubled: $(cat "$FILE")"

ALERT_WEBHOOK_URL_2='https://hooks.slack.com/services/T000/B000/xyz' run
[ "$(cat "$FILE")" = 'https://hooks.slack.com/services/T000/B000/xyz' ] && ok "a Slack URL is written as it is" || bad "a Slack URL must not be altered"

if grep -q 'AbCdEfSecretTokenValue' "$WORK/out"; then bad "the URL was printed"; else ok "the URL is never printed"; fi

# In place: the same inode, so a container bind-mounting the file sees the new content.
ALERT_WEBHOOK_URL_2="$DISCORD" run
before="$(ls -i "$FILE" | awk '{print $1}')"
ALERT_WEBHOOK_URL_2="$DISCORD/other" run
after="$(ls -i "$FILE" | awk '{print $1}')"
[ -n "$before" ] && [ "$before" = "$after" ] && ok "the file is rewritten in place (same inode), never replaced" || bad "the file was replaced (inode $before -> $after)"

[ "$(stat -c %a "$FILE" 2>/dev/null || stat -f %Lp "$FILE")" = 644 ] && ok "the file is readable by the container's unprivileged user (644)" || bad "the file mode is not 644"

# --test
rm -f "$SENT"
ALERT_WEBHOOK_URL_2="$DISCORD" run --test
[ "$RC" = 0 ] && grep -q 'slack' "$SENT" && grep -q 'tersambung' "$SENT" && ok "--test posts one line to the channel" || bad "--test did not post (rc=$RC)"

rm -f "$SENT"
ALERT_WEBHOOK_URL_2="$DISCORD" run
[ ! -e "$SENT" ] && ok "without --test nothing is posted" || bad "a plain run posted a message"

ALERT_WEBHOOK_URL_2="$DISCORD" CURL_FAILS=1 run --test
[ "$RC" = 1 ] && grep -q 'NOT delivered' "$WORK/out" && ok "a test message that does not arrive is exit 1, and says so" || bad "an undelivered test must fail (rc=$RC)"

# Wiring
grep -q 'alertmanager-secondary' docker-compose.prod.yml && grep -q '/etc/alertmanager/secondary' docker-compose.prod.yml &&
  ok "compose mounts the secondary DIRECTORY into alertmanager" || bad "docker-compose.prod.yml does not mount ops/alertmanager-secondary"
grep -q 'alertmanager-secondary' .gitignore && ok "the URL file is gitignored" || bad ".gitignore does not cover ops/alertmanager-secondary"

[ "$fails" -eq 0 ] && echo "second alert channel: all checks passed" || {
  echo "second alert channel: $fails check(s) failed"
  exit 1
}
