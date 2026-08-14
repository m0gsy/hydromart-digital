#!/usr/bin/env sh
# Export the variables in ./.env — WITHOUT running the file.
#
# Sourced, never executed:
#
#   cd "$REPO" && . ./scripts/load-env.sh && bash scripts/watchdog.sh
#
# Why this exists instead of `set -a; . ./.env; set +a`: sourcing RUNS the file. On
# 2026-08-11 a secret went into the live .env as a raw multi-line PEM, so the shell tried to
# execute the key body — `./.env: line 115: PRIVATE: command not found` — and the non-zero
# exit aborted the deploy's migration step, restoring the tree and leaving two migrations
# unapplied. The same `. ./.env` sat in front of the nightly backup, the weekly restore
# drill and the 5-minute watchdog, joined by `&&`: one malformed line silences all three,
# and nothing says so. It is also arbitrary code execution out of a file that only ever
# needs reading.
#
# So: read line by line, keep what is a shell-safe NAME=VALUE, and report the rest on
# stderr rather than dropping it silently — a skipped line is usually a typo'd secret, and
# the caller deserves to know which one.
[ -f .env ] || {
  echo "load-env: no .env in $PWD — fill it first (see .env.production.example)" >&2
  return 1 2>/dev/null || exit 1
}

# A literal CR, built once. This file is POSIX sh, where $'\r' is not an escape
# sequence but the four characters you can see — so stripping that strips nothing.
__le_cr=$(printf '\r')
__le_skipped=''
__le_drops=0
__le_n=0
# `|| [ -n "$__le_line" ]` so a final line with no trailing newline is still read.
while IFS= read -r __le_line || [ -n "$__le_line" ]; do
  __le_n=$((__le_n + 1))
  case "$__le_line" in
    '' | '#'*) continue ;;
  esac
  __le_key=${__le_line%%=*}
  # No '=' at all, or a name no shell would accept (a PEM body, a JSON fragment, a
  # continuation line): data, not a variable.
  case "$__le_key" in
    "$__le_line" | '' | [0-9]* | *[!A-Za-z0-9_]*)
      __le_skipped="${__le_skipped}${__le_skipped:+, }${__le_n}"
      __le_drops=$((__le_drops + 1))
      continue
      ;;
  esac
  __le_val=${__le_line#*=}
  # A .env written on Windows ends every line with CR, and CR is a control
  # character: it survives into the value, then into a JSON body, and the server
  # answers "Bad control character in string literal" — which reads as a broken
  # request rather than a broken file. `scripts/smoke.sh` died at its OTP step on
  # exactly this.
  __le_val=${__le_val%"$__le_cr"}
  # One layer of surrounding quotes, the way the .env format writes them.
  case "$__le_val" in
    \"*\") __le_val=${__le_val#\"} && __le_val=${__le_val%\"} ;;
    \'*\') __le_val=${__le_val#\'} && __le_val=${__le_val%\'} ;;
  esac
  export "$__le_key=$__le_val"
done <.env

[ "$__le_drops" -eq 0 ] ||
  echo "load-env: skipped $__le_drops non-KEY=VALUE line(s) in .env: $__le_skipped" >&2

unset __le_line __le_key __le_val __le_skipped __le_drops __le_n
