#!/usr/bin/env bash
# H-37 — report a backup or restore-drill outcome to admin-service, so /hq/retention
# shows what actually happened.
#
# The console has had a "Backup status" card since Design 19e with NO writer anywhere in
# the repo: it could only ever say NONE, sitting next to a cron job that had been dumping
# the cluster nightly for months. Nobody looking at that page could tell a working backup
# from a broken one.
#
# Delivery goes through `compose exec admin`, not curl from the host: admin-service is not
# published to the host (only gateway :8080 and web :3000 are), the gateway strips
# x-internal-key from inbound requests by design, and the container already holds the
# shared key — so this needs no new port, no new firewall hole and no copy of the secret
# outside the compose environment.
#
# Fail-open on purpose: a reporting failure must never fail the backup it reports on.

# report_backup_run <BACKUP|DRILL> <OK|FAILED> [detail]
report_backup_run() {
  local kind="$1" status="$2" detail
  # Detail is passed as an argv value, so JSON escaping is Node's problem, not the
  # shell's. Quotes and backslashes are still stripped because this text is echoed into
  # a cron log and read by a human, and 500 chars is the column's limit.
  detail="$(printf '%s' "${3:-}" | tr -d '"\\' | tr '\n\r' '  ' | cut -c1-500)"

  if ! $COMPOSE exec -T admin node -e '
    const [kind, status, detail] = process.argv.slice(1);
    const port = process.env.ADMIN_SERVICE_PORT || 3017;
    fetch(`http://localhost:${port}/api/v1/retention/internal/backup-status`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-key": process.env.INTERNAL_SERVICE_KEY || "",
      },
      body: JSON.stringify({ kind, status, detail }),
    })
      .then((r) => process.exit(r.ok ? 0 : 1))
      .catch(() => process.exit(1));
  ' "$kind" "$status" "$detail" >/dev/null 2>&1; then
    echo "[report] could not record $kind=$status in admin-service (non-fatal)" >&2
    return 0
  fi
  echo "[report] recorded $kind=$status"
}
