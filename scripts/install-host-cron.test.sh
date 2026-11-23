#!/usr/bin/env bash
# Self-check for the crontab block scripts/install-host-cron.sh installs.
#
#   bash scripts/install-host-cron.test.sh
#
# The three jobs in that block are the nightly backup, the weekly restore drill and the
# 5-minute watchdog — the things that notice when production is broken. Nothing here
# touches a real crontab: `--show` prints the block and this asserts its shape.
set -uo pipefail
cd "$(dirname "$0")/.."

fails=0
ok() { echo "  ok   $1"; }
bad() {
  echo "  FAIL $1"
  fails=$((fails + 1))
}

echo "install-host-cron.sh:"

block="$(bash scripts/install-host-cron.sh --show 2>/dev/null)"

# C1b: the host runs UTC and a bare crontab follows the host, so "0 3" meant 10:00 WIB.
case "$block" in
  *"CRON_TZ=Asia/Jakarta"*) ok "declares the business zone, so 03:00 means 03:00 WIB" ;;
  *) bad "declares the business zone — block was: $block" ;;
esac

# One variable moves the container clock and this one together.
override="$(SCHEDULER_TZ=Pacific/Auckland bash scripts/install-host-cron.sh --show 2>/dev/null)"
case "$override" in
  *"CRON_TZ=Pacific/Auckland"*) ok "follows SCHEDULER_TZ when the operator sets one" ;;
  *) bad "follows SCHEDULER_TZ when the operator sets one" ;;
esac

# CRON_TZ only works ahead of the job lines: cron applies it to entries that FOLLOW it.
tz_line="$(printf '%s\n' "$block" | grep -n '^CRON_TZ=' | cut -d: -f1)"
first_job="$(printf '%s\n' "$block" | grep -n '^[0-9*]' | head -1 | cut -d: -f1)"
if [ -n "$tz_line" ] && [ -n "$first_job" ] && [ "$tz_line" -lt "$first_job" ]; then
  ok "declares it BEFORE the first job, which is the only place cron reads it"
else
  bad "declares it before the first job (CRON_TZ at $tz_line, first job at $first_job)"
fi

for job in backup-db.sh restore-db.sh watchdog.sh; do
  case "$block" in
    *"$job"*) ok "still schedules $job" ;;
    *) bad "still schedules $job" ;;
  esac
done

# HD-9b: the AI web's database on hydromart's schedule, as jobs of their own: the nightly dump,
# its offsite copy, and the weekly drill writing the log check-backup-freshness.sh watches.
for want in 'bash scripts/backup-aiweb-db.sh >> /var/log/hydromart-backup.log' \
  'bash scripts/backup-offsite.sh --aiweb >> /var/log/hydromart-backup.log' \
  'bash scripts/backup-aiweb-db.sh --drill >> /var/log/hydromart-aiweb-drill.log'; do
  printf '%s\n' "$block" | grep -qF "$want" && ok "schedules: $want" || bad "does not schedule: $want"
done
grep -qF 'hydromart-aiweb-drill.log}' scripts/check-backup-freshness.sh &&
  ok "the AI web drill writes the log the freshness check reads" || bad "the AI web drill log and the freshness check disagree"
printf '%s\n' "$block" | grep -qx 'AIWEB_DRILL_LOG=/var/log/hydromart-aiweb-drill.log' &&
  ok "  ...and the block names that file to the freshness check" || bad "the block does not set AIWEB_DRILL_LOG to the drill's log"

# The AI web drill's log is newer than the box: without passwordless sudo it cannot be created,
# and that must not keep the block from installing. A fake sudo and a fake crontab stand in.
W="$(mktemp -d)"
mkdir -p "$W/bin"
cat > "$W/bin/sudo" <<'SH'
#!/usr/bin/env bash
case "$*" in *"${SUDO_FAILS_FOR:-no such log}"*) exit 1 ;; esac
exit 0
SH
cat > "$W/bin/crontab" <<'SH'
#!/usr/bin/env bash
case "$1" in
  -l) cat "$FAKE_CRONTAB" 2>/dev/null || exit 1 ;;
  -) cat > "$FAKE_CRONTAB" ;;
esac
SH
chmod +x "$W/bin/sudo" "$W/bin/crontab"
fallback="$PWD/.deploy/hydromart-aiweb-drill.log"
had_fallback=0
[ -e "$fallback" ] && had_fallback=1
had_deploy_dir=0
[ -d .deploy ] && had_deploy_dir=1
# No crontab at all yet (the fake crontab -l exits 1, as the real one does): it must install anyway.
PATH="$W/bin:$PATH" FAKE_CRONTAB="$W/tab" SUDO_FAILS_FOR=hydromart-aiweb-drill bash scripts/install-host-cron.sh >/dev/null 2>"$W/err"
rc=$?
[ "$rc" = 0 ] && grep -q 'scripts/backup-db.sh' "$W/tab" 2>/dev/null &&
  ok "an AI web drill log that cannot be created does not stop the install (on a box with no crontab yet)" || bad "the install stopped (rc=$rc): $(cat "$W/err")"
grep -qF "backup-aiweb-db.sh --drill >> $fallback 2>&1" "$W/tab" 2>/dev/null && [ -e "$fallback" ] &&
  ok "  ...the drill logs to a file under the repo it can write" || bad "the drill's fallback log: $(grep -F -- '--drill' "$W/tab" 2>/dev/null)"
grep -qx "AIWEB_DRILL_LOG=$fallback" "$W/tab" 2>/dev/null && ok "  ...and the freshness check is pointed at that same file" ||
  bad "AIWEB_DRILL_LOG does not follow the fallback: $(grep AIWEB_DRILL_LOG "$W/tab" 2>/dev/null)"
grep -qF 'touch /var/log/hydromart-aiweb-drill.log' "$W/err" && ok "  ...and it says what root has to run once" || bad "no root command in: $(cat "$W/err")"
[ "$had_fallback" = 1 ] || rm -f "$fallback"
[ "$had_deploy_dir" = 1 ] || rmdir .deploy 2>/dev/null
PATH="$W/bin:$PATH" FAKE_CRONTAB="$W/tab2" SUDO_FAILS_FOR=hydromart-backup bash scripts/install-host-cron.sh >/dev/null 2>&1
rc=$?
[ "$rc" = 1 ] && [ ! -e "$W/tab2" ] && ok "hydromart's own logs are still a hard stop: nothing installed without them" ||
  bad "a missing hydromart log should stop the install (rc=$rc)"
rm -rf "$W"

# The block is an UNQUOTED heredoc (it expands $REPO), so a backtick in one of its comments is a
# command: three of them ran `pod/`, `payment-proof/` and `ops/docker-daemon.json` on every
# install, and printed errors nobody read. --show must be silent on stderr.
errs="$(bash scripts/install-host-cron.sh --show 2>&1 >/dev/null)"
[ -z "$errs" ] && ok "printing the block runs nothing (no backtick in its comments)" ||
  bad "printing the block ran something: $(printf '%s' "$errs" | head -2 | tr '\n' ' ')"

# Sourcing .env would run it; every one of these lines reads it instead (see load-env.sh).
case "$block" in
  *'. ./scripts/load-env.sh'*) ok "each job reads .env rather than executing it" ;;
  *) bad "each job reads .env rather than executing it" ;;
esac

if [ "$fails" -gt 0 ]; then
  echo "install-host-cron.sh: $fails check(s) failed" >&2
  exit 1
fi
echo "install-host-cron.sh: all checks passed"
