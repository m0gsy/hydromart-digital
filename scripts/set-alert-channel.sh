#!/usr/bin/env bash
# Point the SECOND alert channel at a webhook, and prove it reaches the channel.
#
#   ALERT_WEBHOOK_URL_2=<discord or slack incoming-webhook URL> bash scripts/set-alert-channel.sh [--test]
#
# Alertmanager sends every CRITICAL alert to two receivers (ops/alertmanager.yml): the first
# webhook it always had, and this one. One webhook, one channel and one person was the whole
# alerting path; a second destination is the difference between "the owner's phone was off" and
# "nobody was told".
#
# The URL is a secret, so it travels as an environment variable (the repo secret ALERT_WEBHOOK_URL_2,
# handed through the Deploy workflow) and is written to ops/alertmanager-secondary/webhook-url on the
# box — a file, gitignored, in a DIRECTORY that compose bind-mounts. It is never printed.
#
# Why a directory, and why "in place":
#   * A single-file bind mount whose source does not exist becomes a ROOT-OWNED DIRECTORY the moment
#     compose creates the container, and no script can then write a file there. A directory mount
#     is created empty and stays fillable.
#   * The file is rewritten in place (same inode), never with mv: a bind-mounted file replaced by a
#     rename keeps showing the old content inside the container until it is recreated.
#
# Discord answers Slack-format payloads at the `/slack` suffix, which is what Alertmanager's
# slack_configs sends; it is appended when missing, once.
#
# --test posts one line to the channel so the human who gave the URL sees it arrive.
# Exit: 0 written (and test delivered) · 1 test delivery failed · 2 not configured / not a webhook URL.
set -euo pipefail

cd "$(dirname "$0")/.."

DIR=ops/alertmanager-secondary
FILE="$DIR/webhook-url"
TEST=false
[ "${1:-}" = "--test" ] && TEST=true

URL="${ALERT_WEBHOOK_URL_2:-}"
if [ -z "$URL" ]; then
  echo "!! ALERT_WEBHOOK_URL_2 is not set (it is a GitHub repository secret, handed through Deploy -> alert-channel-2)." >&2
  exit 2
fi
case "$URL" in
  https://discord.com/api/webhooks/* | https://discordapp.com/api/webhooks/* | https://hooks.slack.com/services/*) ;;
  *)
    echo "!! ALERT_WEBHOOK_URL_2 is not a Discord or Slack incoming-webhook URL; refusing to write it anywhere." >&2
    exit 2
    ;;
esac
case "$URL" in
  https://discord*) case "$URL" in */slack) ;; *) URL="${URL%/}/slack" ;; esac ;;
esac

if [ ! -d "$DIR" ]; then
  mkdir -p "$DIR"
fi
if [ ! -w "$DIR" ]; then
  # Docker created it as root on a deploy that mounted it before this ran.
  if ! sudo -n chown "$(id -u):$(id -g)" "$DIR" 2>/dev/null; then
    echo "!! $DIR is not writable by $(id -un) and passwordless sudo is unavailable." >&2
    exit 2
  fi
fi

# In place, and readable by the container's unprivileged user (Alertmanager runs as `nobody`).
chmod 755 "$DIR"
printf '%s' "$URL" > "$FILE"
chmod 644 "$FILE"
echo "second alert channel written to $FILE ($(wc -c < "$FILE" | tr -d ' ') bytes; the URL is not shown)"

if $TEST; then
  text="Hydromart: kanal alert kedua tersambung. Alert critical akan masuk ke sini juga (pesan uji, abaikan)."
  if curl -fsS -m 15 -X POST -H 'content-type: application/json' \
    --data "{\"text\":\"${text}\",\"content\":\"${text}\"}" "$URL" > /dev/null 2>&1; then
    echo "test message delivered"
  else
    echo "!! the test message was NOT delivered — check the webhook (deleted? wrong channel?)." >&2
    exit 1
  fi
fi
