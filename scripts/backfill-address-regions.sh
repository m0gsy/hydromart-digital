#!/usr/bin/env bash
# HD-20a: give the old pinned addresses their kecamatan / kelurahan code (scripts/backfill-address-regions.mjs).
#
#   bash scripts/backfill-address-regions.sh                                              # DRY RUN: counts, writes nothing
#   CONFIRM=BACKFILL-ADDRESS-REGIONS bash scripts/backfill-address-regions.sh --execute   # fills the codes
#
# Read the dry-run numbers first: "N alamat berpin tanpa kode wilayah: X dapat kecamatan + kelurahan,
# Y hanya kecamatan, Z tanpa kode". Z is pins outside DKI/Jabar/Banten or too coarse, they stay empty.
# If every row is "tanpa kode" the asset did not load (the mjs stops in that case, exit 1).
#
# No database dump first, on purpose: the mjs only ever fills a NULL kecamatanCode (its updateMany keeps
# `kecamatanCode: null` in the where) and never overwrites a value, so a re-run is harmless and the
# worst case is "still empty".
#
# It does NOT `docker exec` into the live customer container: that one has mem_limit 512m and the mjs
# parses the 9 MB regions.json a second time, so an out-of-memory kill would take the live service
# down. Instead a ONE-OFF container is started from the very same image (same code, same regions.json),
# on the same network, with only CUSTOMER_DATABASE_URL, and a bigger memory limit.
#
# `-w /app/packages` plus the mjs on stdin: on stdin Node resolves relative imports from the cwd
# (import.meta.url = file:///<cwd>/[eval1]), so `../services/customer-service/...` from /app/packages
# lands on /app/services/customer-service. /app/packages exists in the runtime image; argv.slice(2)
# carries the flag.
set -uo pipefail

cd "$(dirname "$0")/.."

FLAG=--dry-run
case "${1:-}" in
  "") ;;
  --execute)
    if [ "${CONFIRM:-}" != "BACKFILL-ADDRESS-REGIONS" ]; then
      echo "!! refusing: set CONFIRM=BACKFILL-ADDRESS-REGIONS to say you mean it. Nothing was run." >&2
      exit 2
    fi
    FLAG="" ;;
  *) echo "usage: $0 [--execute]" >&2; exit 2 ;;
esac

if [ -n "${CUSTOMER_CONTAINER:-}" ]; then
  C="$CUSTOMER_CONTAINER"
else
  CS="$(docker ps --filter 'label=com.docker.compose.project=hydromart' --filter 'label=com.docker.compose.service=customer' --format '{{.Names}}' 2>/dev/null)"
  if [ "$(printf '%s\n' "$CS" | grep -c .)" -ne 1 ]; then
    echo "!! expected exactly one running hydromart customer-service container, found: $(printf '%s' "${CS:-none}" | tr '\n' ' '). Set CUSTOMER_CONTAINER." >&2
    exit 2
  fi
  C="$CS"
fi

IMAGE="$(docker inspect -f '{{.Image}}' "$C" 2>/dev/null)"
NET="$(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{println $k}}{{end}}' "$C" 2>/dev/null | grep -m1 .)"
if [ -z "$IMAGE" ] || [ -z "$NET" ]; then
  echo "!! cannot read the image or network of $C." >&2
  exit 2
fi

# Only the one env line is handed over, through a private temp file (never echoed, never on argv).
ENVF="$(mktemp)"
trap 'rm -f "$ENVF"' EXIT
chmod 600 "$ENVF"
docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$C" 2>/dev/null | grep '^CUSTOMER_DATABASE_URL=' >"$ENVF"
if [ ! -s "$ENVF" ]; then
  echo "!! $C has no CUSTOMER_DATABASE_URL." >&2
  exit 2
fi

echo "backfill-address-regions: $([ -z "$FLAG" ] && echo EXECUTE || echo 'dry run, nothing will be written') (container $C)"
# FLAG is empty on --execute, so it is left unquoted on purpose.
# shellcheck disable=SC2086
docker run --rm -i --memory 768m --network "$NET" --env-file "$ENVF" -w /app/packages "$IMAGE" \
  node --input-type=module - $FLAG <scripts/backfill-address-regions.mjs
RC=$?
[ "$RC" -eq 0 ] && [ -n "$FLAG" ] && echo "Dry run only. To fill the codes: CONFIRM=BACKFILL-ADDRESS-REGIONS bash $0 --execute"
exit "$RC"
