#!/usr/bin/env bash
# Proof that scripts/report-damaged-rows.sh cannot write.
#
#   bash scripts/check-report-damaged-rows.test.sh
#
# The owner's decision on step 08 was explicit: a dry run and a report, with no `--apply` at
# all. A data-repair script that carries a write path is a script somebody eventually runs,
# and these five classes each need a human to decide what the right number IS.
#
# A promise in a comment is not a guarantee. This is the guarantee: the file is read, and a
# write statement anywhere in it fails the build. It needs no database and no Docker, so it
# runs on every CI machine.
set -uo pipefail
cd "$(dirname "$0")/.."

TARGET=scripts/report-damaged-rows.sh
fails=0
ok() { echo "  ok   $1"; }
bad() {
  echo "  FAIL $1"
  fails=$((fails + 1))
}

[ -f "$TARGET" ] || {
  echo "FAIL — $TARGET is missing."
  exit 1
}

# Comment lines are stripped first, twice over: the script EXPLAINS that it has no UPDATE
# and no --apply, and a gate that trips on its own explanation teaches people to delete the
# explanation. What is checked is what the shell would run.
code() { grep -vE '^[[:space:]]*#' "$1" | grep -vE '^[[:space:]]*(say|echo)[[:space:]]'; }

# The write verbs, case-insensitive. NOT anchored on a non-quote character: every statement
# in the target lives inside a double-quoted psql argument, so excluding \" was exactly the
# blind spot that let the self-test's own probe through.
WRITES='(insert[[:space:]]+into|update[[:space:]]+"?[a-z_]+"?[[:space:]]+set|delete[[:space:]]+from|truncate|drop[[:space:]]+(table|column)|alter[[:space:]]+table)'

# --- 1: no write verb, in any casing ---------------------------------------
if code "$TARGET" | grep -inE "$WRITES" >/dev/null; then
  bad "a write statement is present:"
  code "$TARGET" | grep -inE "$WRITES"
else
  ok "no INSERT / UPDATE … SET / DELETE / TRUNCATE / DROP / ALTER anywhere in the script"
fi

# --- 2: no apply flag, however spelled -------------------------------------
if code "$TARGET" | grep -inE -- "--(apply|write|fix|repair|execute)" >/dev/null; then
  bad "an apply-style flag is present — the owner's decision was that none exists:"
  code "$TARGET" | grep -inE -- "--(apply|write|fix|repair|execute)"
else
  ok "no --apply / --write / --fix flag"
fi

# --- 3: it still parses -----------------------------------------------------
if bash -n "$TARGET" 2>/dev/null; then
  ok "the script parses"
else
  bad "the script does not parse"
fi

# --- 4: the gate can actually go red ----------------------------------------
# A check that has never failed is a check nobody has tested. This runs the same grep over a
# copy with one UPDATE added, and expects it to fire.
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
cp "$TARGET" "$WORK/probe.sh"
printf '\nq payout "UPDATE courier_withdrawals SET status = %s;"\n' "'PAID'" >> "$WORK/probe.sh"
if code "$WORK/probe.sh" | grep -inE "$WRITES" >/dev/null; then
  ok "the same grep catches an UPDATE added to a copy — the gate can go red"
else
  bad "an UPDATE added to a copy was NOT caught; this gate proves nothing"
fi

echo
if [ "$fails" -eq 0 ]; then
  echo "PASS — the damaged-row report is read-only, and the check that says so can fail."
  exit 0
fi
echo "FAIL — $fails assertion(s) above."
exit 1
