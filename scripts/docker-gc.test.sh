#!/usr/bin/env bash
# M13 — the flag has to actually change what runs, and the between-batches caller has to
# use it. Both are one grep away from silently reverting, and the symptom (every batch
# rebuilding what the last one built) is invisible except as a deploy that takes 39 minutes.
set -euo pipefail
cd "$(dirname "$0")/.."
fails=0

check() {
  if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: expected '$2', got '$3'"; fails=1; fi
}

# A fake `docker` that just prints its arguments, so the test reads the commands rather than
# running them.
tmp="$(mktemp -d)"
cat > "$tmp/fake-docker" <<'EOF'
#!/usr/bin/env bash
echo "$@"
EOF
chmod +x "$tmp/fake-docker"

full="$(DOCKER_BIN="$tmp/fake-docker" bash scripts/docker-gc.sh 2>/dev/null | grep -c 'builder prune' || true)"
images="$(DOCKER_BIN="$tmp/fake-docker" bash scripts/docker-gc.sh --images-only 2>/dev/null | grep -c 'builder prune' || true)"
imagePrune="$(DOCKER_BIN="$tmp/fake-docker" bash scripts/docker-gc.sh --images-only 2>/dev/null | grep -c 'image prune' || true)"

check "default run trims the build cache" 1 "$full"
check "--images-only leaves the build cache alone" 0 "$images"
check "--images-only still reclaims dangling images" 1 "$imagePrune"

# The caller: between batches must be images-only, and the tail must do the full trim.
between="$(grep -c 'docker-gc.sh --images-only' scripts/rebuild-stale.sh || true)"
tail_trim="$(grep -c 'bash scripts/docker-gc.sh$' scripts/rebuild-stale.sh || true)"
check "rebuild-stale prunes images only between batches" 1 "$between"
check "rebuild-stale trims the build cache once at the end" 1 "$tail_trim"

rm -rf "$tmp"
exit "$fails"
