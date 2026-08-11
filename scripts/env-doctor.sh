#!/usr/bin/env bash
# Diagnose — and repair — a .env line that is not a KEY=VALUE line.
#
#   bash scripts/env-doctor.sh --inspect   # read-only: which lines, truncated to 32 chars
#   bash scripts/env-doctor.sh --fix       # join a multi-line PEM into one \n-escaped line
#
# Why: a secret written into the live .env as a raw multi-line PEM was executed by the old
# `. ./.env` and killed the deploy's migration step (2026-08-11). load-env.sh stops that
# from breaking anything, but the VALUE is still wrong — a real newline truncates it at the
# first one, and the symptom is every Android push failing with an unusable key. This puts
# the value back into the single-line `\n` form the format asks for, out of the lines
# already on the box: nothing new is needed, and nothing secret is printed.
#
# Exit codes: 0 repaired · 3 a PEM with no END line (refused, file untouched) · 4 nothing
# to do · 1 usage/missing file.
set -uo pipefail
# Deliberately no `cd`: this works on the .env of the directory it is CALLED from, which is
# the deployment root on the box. Chasing the script's own location would make it edit the
# checkout's .env instead of the live one.
MODE="${1:---inspect}"
[ -f .env ] || {
  echo "env-doctor: no .env in $PWD" >&2
  exit 1
}

case "$MODE" in
  --inspect)
    # Exactly the lines load-env.sh skips, truncated: enough to name the culprit, never
    # enough to leak it. A .env is read by people over someone's shoulder.
    echo "env-doctor: lines that are not KEY=VALUE (truncated to 32 chars):"
    awk '
      /^[[:space:]]*$/ || /^[[:space:]]*#/ { next }
      /^[A-Za-z_][A-Za-z0-9_]*=/ { next }
      { printf "  %d: %.32s\n", NR, $0 }
    ' .env
    echo "env-doctor: (a PEM shows up as its body lines; --fix joins it back together)"
    ;;

  --fix)
    BACKUP=".env.bak.$(date +%Y%m%d-%H%M%S)"
    cp .env "$BACKUP"
    awk '
      # A key whose value opens a PEM, with the newlines still real. Optional opening quote:
      # someone may have quoted the first line and still pasted the body underneath.
      # …and NOT one that already carries its END marker on the same line: that is the
      # repaired form, and re-running must be a no-op rather than eat the next lines.
      !joining && /^[A-Za-z_][A-Za-z0-9_]*="?-----BEGIN / && !/-----END / {
        key = $0; sub(/=.*/, "", key)
        val = $0; sub(/^[^=]*=/, "", val); sub(/^"/, "", val)
        buf = key "=\"" val
        start = NR
        joining = 1
        next
      }
      joining {
        line = $0; sub(/"[[:space:]]*$/, "", line)
        buf = buf "\\n" line
        if (line ~ /-----END .*-----[[:space:]]*$/) {
          print buf "\""
          printf "env-doctor: joined %s (lines %d-%d) into one line\n", key, start, NR > "/dev/stderr"
          joining = 0
          fixed++
        }
        next
      }
      { print }
      END {
        if (joining) {
          print "env-doctor: !! " key " opens a PEM at line " start " that never ends — refusing to guess" > "/dev/stderr"
          exit 3
        }
        if (!fixed) {
          print "env-doctor: nothing to join — no multi-line PEM in .env" > "/dev/stderr"
          exit 4
        }
      }
    ' .env >.env.doctored
    rc=$?
    if [ "$rc" != 0 ]; then
      # Refused or nothing to do: the original stays, and so does no stray backup.
      rm -f .env.doctored "$BACKUP"
      exit "$rc"
    fi
    # Same owner and mode as the file it replaces — this one holds every secret on the box.
    cat .env.doctored >.env
    rm -f .env.doctored
    echo "env-doctor: .env repaired; previous copy kept at $BACKUP"
    echo "env-doctor: restart whatever reads that key (docker compose up -d) to pick it up"
    ;;

  *)
    echo "usage: bash scripts/env-doctor.sh [--inspect|--fix]" >&2
    exit 1
    ;;
esac
