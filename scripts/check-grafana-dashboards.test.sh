#!/usr/bin/env bash
# The runnable check for scripts/check-grafana-dashboards.mjs — and for the dashboard itself.
#
#   bash scripts/check-grafana-dashboards.test.sh
#
# Two halves. The gate is shown red for each way a provisioned dashboard goes quietly wrong
# (broken JSON, no datasource variable, a hard-coded datasource, an empty query, a metric nothing
# exports). Then every query in the real dashboard is handed to promtool as a recording rule, so
# a PromQL typo fails HERE instead of drawing an empty graph at 02:00 that reads as "all quiet".
# The promtool half skips, saying so, when there is no Docker daemon.
set -uo pipefail
# CI invokes this as `bash -e file`; the negative cases below are SUPPOSED to exit non-zero.
set +e
cd "$(dirname "$0")/.."
ROOT="$PWD"
GATE="$ROOT/scripts/check-grafana-dashboards.mjs"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

fails=0
ok() { echo "  ok   $1"; }
bad() {
  echo "  FAIL $1"
  fails=$((fails + 1))
}

DIR="$WORK/dash"
mkdir -p "$DIR"
run() {
  OUT="$(GRAFANA_DASHBOARDS_DIR="$DIR" node "$GATE" 2>&1)"
  RC=$?
}
write() { # <expr> [datasource-uid] [with-variable: yes|no]
  local uid="${2:-\${ds\}}" var="${3:-yes}" list='[{"name":"ds","type":"datasource","query":"prometheus"}]'
  [ "$var" = no ] && list='[]'
  cat > "$DIR/d.json" <<JSON
{"uid":"t","title":"T","templating":{"list":$list},"panels":[
 {"id":1,"type":"row","title":"r"},
 {"id":2,"type":"stat","title":"p","datasource":{"type":"prometheus","uid":"$uid"},
  "targets":[{"datasource":{"type":"prometheus","uid":"$uid"},"expr":$1,"refId":"A"}]}]}
JSON
}

echo "check-grafana-dashboards:"

write '"sum(rate(http_request_duration_seconds_count[5m]))"'
run
[ "$RC" = 0 ] && ok "green on a well-formed dashboard" || bad "should pass: $OUT"

echo '{ not json' > "$DIR/d.json"
run
[ "$RC" = 1 ] && ok "RED on JSON Grafana could not read" || bad "broken JSON must fail (rc=$RC)"

write '"up"' '${ds}' no
run
[ "$RC" = 1 ] && ok "RED when there is no datasource variable" || bad "a missing ds variable must fail (rc=$RC)"

write '"up"' 'abc123'
run
[ "$RC" = 1 ] && ok "RED when a panel hard-codes a datasource uid" || bad "a hard-coded uid must fail (rc=$RC)"

write '" "'
run
[ "$RC" = 1 ] && ok "RED on an empty query" || bad "an empty query must fail (rc=$RC)"

write '"sum(rate(order_widgets_total[5m]))"'
run
[ "$RC" = 1 ] && case "$OUT" in *order_widgets_total*) ok "RED on a metric nothing exports, and names it" ;; *) bad "should name the metric: $OUT" ;; esac || bad "an unknown metric must fail (rc=$RC)"

# Label names and `by (...)` clauses are not metrics.
write '"sum by (service_name) (rate(http_request_duration_seconds_count{some_label=\"x\"}[5m]))"'
run
[ "$RC" = 0 ] && ok "label names and by() clauses are not mistaken for metrics" || bad "labels must not be flagged: $OUT"

rm -rf "$DIR" && mkdir -p "$DIR"
run
[ "$RC" = 1 ] && ok "RED when there are no dashboards at all (an empty mount)" || bad "no dashboards must fail (rc=$RC)"

OUT="$(node "$GATE" 2>&1)"
[ "$?" = 0 ] && ok "the repository's dashboards pass" || bad "repo should pass: $OUT"

# ------------------------------------------------------------------------- the PromQL itself
if ! docker version >/dev/null 2>&1; then
  echo "  SKIPPED — no Docker daemon, so promtool cannot parse the queries here."
elif ! docker image inspect prom/prometheus:v2.54.1 >/dev/null 2>&1 && ! docker pull -q prom/prometheus:v2.54.1 >/dev/null 2>&1; then
  echo "  SKIPPED — prom/prometheus is not available (no image, no network)."
else
  IMAGE="$(sed -n 's/.*image: *\(prom\/prometheus:[^ ]*\).*/\1/p' docker-compose.prod.yml | head -1)"
  IMAGE="${IMAGE:-prom/prometheus:v2.54.1}"
  # Every expression of every dashboard becomes a recording rule; promtool refuses one it cannot parse.
  node -e '
    const fs = require("fs");
    const dir = process.argv[1];
    const rules = [];
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json"))) {
      const doc = JSON.parse(fs.readFileSync(dir + "/" + f, "utf8"));
      let n = 0;
      for (const p of doc.panels ?? []) for (const t of p.targets ?? []) {
        n += 1;
        rules.push({ record: "dash:" + f.replace(/\W/g, "_") + ":" + n, expr: t.expr });
      }
    }
    fs.writeFileSync(process.argv[2], JSON.stringify({ groups: [{ name: "dashboards", rules }] }));
  ' "$ROOT/ops/grafana-dashboards" "$WORK/rules.json"
  export MSYS_NO_PATHCONV=1
  HOST_WORK="$(cd "$WORK" && pwd -W 2>/dev/null || pwd)"
  if docker run --rm -v "$HOST_WORK:/w" --entrypoint promtool "$IMAGE" check rules /w/rules.json >"$WORK/promtool.out" 2>&1; then
    ok "promtool parses every query in the real dashboard"
  else
    bad "promtool rejected a dashboard query: $(tail -3 "$WORK/promtool.out" | tr '\n' ' ')"
  fi
  # And the check itself can go red: a broken expression must be refused.
  echo '{"groups":[{"name":"x","rules":[{"record":"dash:x","expr":"sum(rate(http_request_duration_seconds_count[5m])"}]}]}' > "$WORK/broken.json"
  if docker run --rm -v "$HOST_WORK:/w" --entrypoint promtool "$IMAGE" check rules /w/broken.json >/dev/null 2>&1; then
    bad "promtool accepted a query with an unclosed parenthesis — the syntax check proves nothing"
  else
    ok "promtool refuses a broken query (the syntax check can go red)"
  fi
fi

if [ "$fails" -gt 0 ]; then
  echo "check-grafana-dashboards: $fails check(s) failed" >&2
  exit 1
fi
echo "check-grafana-dashboards: all checks passed"
