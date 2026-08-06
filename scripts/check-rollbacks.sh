#!/usr/bin/env bash
# B-21 — every migration must ship with a rollback.sql.
#
# The count drifted from 25-of-98 missing to 39-of-135 between two audits, because nothing
# ever checked. Backfilling them once fixes today; this is what stops tomorrow, and it is
# cheap enough to run on every CI job.
#
#   bash scripts/check-rollbacks.sh
#
# A rollback.sql is not proof that a rollback WORKS — that takes executing one against a
# restored backup (see the ops checklist). It is proof that somebody thought about undoing
# the change at the time they wrote it, which is when the answer is actually known.
set -euo pipefail
cd "$(dirname "$0")/.."

missing=()
while IFS= read -r sql; do
  dir="$(dirname "$sql")"
  [ -f "$dir/rollback.sql" ] || missing+=("$dir")
done < <(find services apps -type f -name migration.sql | sort)

total="$(find services apps -type f -name migration.sql | wc -l | tr -d ' ')"

if [ "${#missing[@]}" -ne 0 ]; then
  echo "!! ${#missing[@]} of $total migrations have no rollback.sql:" >&2
  printf '   %s\n' "${missing[@]}" >&2
  echo >&2
  echo "   Write one next to each migration.sql. It must undo exactly what the migration" >&2
  echo "   did, in reverse order, and say plainly when it cannot be lossless — an honest" >&2
  echo "   'this drops data' is worth more at 3am than a file that exists for the count." >&2
  exit 1
fi

echo "rollbacks: $total/$total migrations have one"
