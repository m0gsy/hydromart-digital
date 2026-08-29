#!/usr/bin/env bash
# The runnable check for BI-2's checker — scripts/check-public-metrics.mjs.
#
#   bash scripts/check-public-metrics.test.sh
#
# A gate that cannot go red is the pattern this audit kept finding, so the gate itself is
# tested: the Caddyfile is copied, broken in four different ways, and the checker must fail
# on each — including the near-miss that looks right (a /metrics block sitting AFTER the
# proxy) and the one that fooled the first version of this checker (matching the
# `{$API_DOMAIN}` that appears inside the WEB site's connect-src instead of the API site).
set -uo pipefail
# NOTE: CI invokes this as `bash -e file`, which sets -e for the whole script regardless of
# what the line below asks for — and this file runs commands that are SUPPOSED to fail
# (pg_isready while Postgres is still starting exits 2; every negative case exits 1). Under
# -e the first of those killed the run and reported the failure as the script's own. So -e
# is switched off explicitly here: the assertions below are the verdict, not the shell's.
set +e
cd "$(dirname "$0")/.."

fails=0
ok() { echo "  ok   $1"; }
bad() {
  echo "  FAIL $1"
  fails=$((fails + 1))
}
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"; cp "$WORK/Caddyfile.orig" infra/caddy/Caddyfile 2>/dev/null || true' EXIT
cp infra/caddy/Caddyfile "$WORK/Caddyfile.orig"

run_check() {
  set +e
  OUT="$(node scripts/check-public-metrics.mjs 2>&1)"
  RC=$?
  set -e
}

restore() { cp "$WORK/Caddyfile.orig" infra/caddy/Caddyfile; }

echo "check-public-metrics:"

run_check
[ "$RC" = 0 ] && ok "passes on the real Caddyfile" || bad "the real Caddyfile should pass: $OUT"

# 1. The state this repo shipped in: everything proxied, /metrics included.
python - "$WORK/Caddyfile.orig" <<'PY'
import io, re, sys
s = io.open(sys.argv[1], encoding='utf-8').read()
s = re.sub(r"\n\thandle /metrics\*.*?\n\t\}\n", "\n", s, flags=re.S)
io.open('infra/caddy/Caddyfile', 'w', encoding='utf-8', newline='\n').write(s)
PY
run_check
[ "$RC" = 1 ] && ok "fails when nothing blocks /metrics" || bad "an unblocked /metrics must fail (rc=$RC)"
case "$OUT" in *"does not block /metrics"*) ok "  ...and says what to add" ;; *) bad "  expected an actionable message: $OUT" ;; esac
restore

# 2. A block that answers 200 is not a refusal.
sed -i 's/respond 404/respond 200/' infra/caddy/Caddyfile
run_check
[ "$RC" = 1 ] && ok "fails when /metrics is answered 200" || bad "respond 200 must fail (rc=$RC)"
restore

# 3. Blocking AFTER the proxy reads as protection and is not.
python - <<'PY'
import io, re
s = io.open('infra/caddy/Caddyfile', encoding='utf-8').read()
block = re.search(r"\n\thandle /metrics\*.*?\n\t\}\n", s, flags=re.S).group(0)
s = s.replace(block, "\n")
s = s.replace("\treverse_proxy gateway:8080\n", "\treverse_proxy gateway:8080\n" + block)
io.open('infra/caddy/Caddyfile', 'w', encoding='utf-8', newline='\n').write(s)
PY
run_check
[ "$RC" = 1 ] && ok "fails when the block sits after reverse_proxy" || bad "ordering must fail (rc=$RC)"
restore

# 4. The site itself gone (renamed hostname variable, a rewritten deploy) is unmeasured, not
#    passed — the first version of this checker matched the API domain inside the WEB site's
#    connect-src and would have reported on the wrong block entirely.
python - <<'PY'
import io
s = io.open('infra/caddy/Caddyfile', encoding='utf-8').read()
s = s.replace("{$API_DOMAIN} {\n\timport hsts", "{$SOMETHING_ELSE} {\n\timport hsts")
io.open('infra/caddy/Caddyfile', 'w', encoding='utf-8', newline='\n').write(s)
PY
run_check
[ "$RC" = 1 ] && ok "fails when the public API site cannot be found at all" || bad "a missing site must fail (rc=$RC)"
restore

exit "$fails"
