#!/usr/bin/env bash
#
# Self-check for scripts/ask-the-box.sh.
#
# `set +e` for the reason its sibling gates document: CI runs self-checks as `bash -e <file>`,
# and several assertions below drive commands that exit non-zero on purpose.
#
# Why this file exists at all: ask-the-box is the ONLY instrument that asks the launch-blocker
# questions where they have answers — on the box. scripts/check-launch-blockers.mjs asks them
# of a developer's .env and a developer's database, and four of its five verdicts were wrong
# because of it. An instrument that important with no self-check is one edit away from
# reporting nothing and looking fine.
#
#   bash scripts/ask-the-box.test.sh
set +e

fails=0
ok() { echo "  ok   $1"; }
bad() { echo "  FAIL $1"; fails=$((fails + 1)); }

echo "ask-the-box.sh:"

# It must PARSE. A read-only diagnostic that dies on a syntax error reports nothing, and the
# workflow that runs it (registry-check.yml, mode `diagnose`) would show a red box with no
# facts in it — indistinguishable from a box that had nothing to say.
if bash -n scripts/ask-the-box.sh 2>/dev/null; then
  ok "parses"
else
  bad "does not parse — the one instrument that can answer these questions would report nothing"
fi

# STRICTLY READ-ONLY is a promise in its header, and the workflow runs it against production.
# A `docker restart`, a `compose up`, a psql INSERT/UPDATE/DELETE or a redirect into a tracked
# file would each break that promise in a way no reviewer would notice in a 200-line script.
MUTATORS='docker (restart|stop|rm|kill)|compose [^|]*(up|down|restart) |(insert|update|delete) into|drop table'
if grep -qEi "$MUTATORS" scripts/ask-the-box.sh; then
  bad "ask-the-box mutates something — its header promises read-only and a workflow points it at production"
else
  ok "still read-only: nothing it runs starts, stops or writes"
fi

# The three keys whose zero is never a decision.
#
# Production served silverDiscountPct = goldDiscountPct = platinumDiscountPct = 0 against
# coded defaults of 2/5/8, and the rows had said so for a while: the script DUMPED settings
# rows, and a dump needs a reader who already knows what the default is. Naming them and
# judging them is what turns the dump into an answer.
for K in silverDiscountPct goldDiscountPct platinumDiscountPct; do
  grep -q "$K" scripts/ask-the-box.sh ||
    bad "ask-the-box does not name $K — a tier promising a discount and paying none reads as just another row"
done
grep -q 'STORED ZERO' scripts/ask-the-box.sh ||
  bad "ask-the-box reports the discount values without judging them; a dump is not an answer"
ok "the membership discounts are named and a stored zero is called out"

# The questions it exists to answer must all still be in it. A section quietly dropped is the
# failure mode of a script nobody has a test for.
for L in L2.1 L2.2 L2.3 L2.4; do
  grep -q "$L" scripts/ask-the-box.sh || bad "the $L section is gone — that question has no other instrument"
done
ok "every launch-blocker question it owns is still asked"

# And something must still RUN it. It is a workflow-dispatch script; if registry-check.yml
# stops calling it, it becomes a file nobody executes — which is what happened to
# check-launch-blockers.test.sh for months.
grep -q 'ask-the-box.sh' .github/workflows/registry-check.yml ||
  bad "no workflow invokes ask-the-box.sh any more — it is the only way to ask these on the box"
ok "registry-check.yml still invokes it"

if [ "$fails" -gt 0 ]; then
  echo "ask-the-box.sh: $fails check(s) failed" >&2
  exit 1
fi
echo "ask-the-box.sh: all checks passed"
