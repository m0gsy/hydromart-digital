#!/usr/bin/env bash
# Self-check for create-indexes.sh, without a database.
#
# The fragile part is not the SQL — it is the two lines of `sed` that pull an index name and
# a table name out of each statement, and they have now been wrong twice in one day: once
# written as `s/…//p` (substituting the match away instead of capturing it, so every table
# name came back empty and every index looked new), and once duplicated so a fix applied to
# one copy and not the other.
#
# So the parsing is asserted here, on the real INDEXES table, with no Postgres in sight.
set -uo pipefail

SCRIPT="$(cd "$(dirname "$0")" && pwd)/create-indexes.sh"

fail() {
  echo "FAIL: $1"
  exit 1
}

# The literal block out of the script, so this test cannot drift from what runs.
INDEXES="$(sed -n "/^INDEXES='/,/^'$/p" "$SCRIPT" | sed "1d;\$d")"
[ -n "$INDEXES" ] || fail 'could not read the INDEXES table out of create-indexes.sh'

COUNT=0
while IFS='|' read -r db idx stmt; do
  [ -z "${db:-}" ] && continue
  COUNT=$((COUNT + 1))

  [ -n "$idx" ] || fail "row $COUNT has no index name"
  [ -n "$stmt" ] || fail "$db.$idx has no statement"

  # 1. The name in the middle field must be the name the statement creates. A mismatch means
  #    the migration builds a SECOND copy under Prisma's default name — the exact trap the
  #    script's own header warns about.
  case "$stmt" in
    *"\"$idx\""*) ;;
    *) fail "$db.$idx: the statement does not create an index called \"$idx\"" ;;
  esac

  # 2. CONCURRENTLY, or the pre-build locks the table it exists to keep unlocked.
  case "$stmt" in
    *"CREATE INDEX CONCURRENTLY"* | *"CREATE UNIQUE INDEX CONCURRENTLY"*) ;;
    *) fail "$db.$idx: not built CONCURRENTLY, which is the entire point of this script" ;;
  esac

  # 3. IF NOT EXISTS, because this runs on every migrating deploy and must be a no-op when
  #    the index is already there.
  case "$stmt" in
    *"IF NOT EXISTS"*) ;;
    *) fail "$db.$idx: missing IF NOT EXISTS, so a re-run would error instead of doing nothing" ;;
  esac

  # 4. The table name must be EXTRACTABLE. This is the assertion that catches the `//p` bug:
  #    an empty table name silently disabled the new-table skip for every row.
  table="$(printf '%s' "$stmt" | sed -n 's/.* ON "\([^"]*\)".*/\1/p')"
  [ -n "$table" ] || fail "$db.$idx: no table name could be parsed out of the statement"
done <<EOF
$INDEXES
EOF

[ "$COUNT" -gt 0 ] || fail 'the INDEXES table parsed to zero rows'
echo "create-indexes: $COUNT statement(s) parse, name-match, are CONCURRENT, and are re-runnable"

# The one-place rule: the new-table skip must be used by BOTH the build loop and the
# end-state re-check. It was in two copies for exactly one deploy, and that deploy skipped
# three indexes correctly and then failed the release for the same three being "MISSING".
USES="$(grep -c 'table_absent "\$db" "\$stmt"' "$SCRIPT" || true)"
[ "$USES" -ge 2 ] || fail "the new-table rule is used $USES time(s); the loop and the end-state check both need it"
echo 'create-indexes: the new-table rule is applied in both places'

# The script's OWN table-name extraction, not a copy of it.
#
# The assertion above (case 4) runs a sed written HERE against the statements. It passed
# every day while the script's own line said `s/.* ON "\([^"]*\)".*/<0x01>/p` — a raw
# control byte where the backreference should be, written by #186 and unnoticed for five
# months. Every table name came back as that byte, no table was ever found, so EVERY index
# took the "its table does not exist yet" branch: nothing was pre-built, and the end-state
# re-check could never report anything MISSING. A no-op that exits 0.
#
# A test that reimplements the thing it is testing cannot see that. This one calls it.
# shellcheck source=/dev/null
TA_TABLE="$(
  # Pull just the function out and run it with a stub psql, so no database is needed.
  sed -n '/^table_absent() {/,/^}/p' "$SCRIPT" > /tmp/ci-ta.$$.sh
  # shellcheck disable=SC1090
  . /tmp/ci-ta.$$.sh
  psql_do() { echo ''; }
  table_absent x 'CREATE INDEX CONCURRENTLY IF NOT EXISTS "foo_idx" ON "some_table"("a")' >/dev/null
  printf '%s' "$_ta_table"
  rm -f /tmp/ci-ta.$$.sh
)"
[ "$TA_TABLE" = "some_table" ] || fail "table_absent extracted [$TA_TABLE], not [some_table] — its sed replacement is not a working backreference, so every index silently takes the new-table skip"
echo 'create-indexes: table_absent extracts a real table name from a real statement'
