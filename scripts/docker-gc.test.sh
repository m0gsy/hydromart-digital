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
# The deploy's stack lock that --old-images takes: a file of this test's own, never the checkout's.
export STACK_LOCK="$tmp/stack.lock"
unset HYDROMART_STACK_LOCKED
cat > "$tmp/fake-docker" <<'EOF'
#!/usr/bin/env bash
echo "$@"
EOF
chmod +x "$tmp/fake-docker"

full="$(DOCKER_BIN="$tmp/fake-docker" bash scripts/docker-gc.sh 2>/dev/null | grep -c 'builder prune' || true)"
images="$(DOCKER_BIN="$tmp/fake-docker" bash scripts/docker-gc.sh --images-only 2>/dev/null | grep -c 'builder prune' || true)"
imagePrune="$(DOCKER_BIN="$tmp/fake-docker" bash scripts/docker-gc.sh --images-only 2>/dev/null | grep -c 'image prune' || true)"

# HD-1: scoped to this project's label (project-isolation.test.sh covers the two-project box).
oldFlag="$(DOCKER_BIN="$tmp/fake-docker" bash scripts/docker-gc.sh --old-images 2>/dev/null | grep -c 'image prune -f -a --filter until=168h --filter label=com.docker.compose.project=hydromart' || true)"
defaultAll="$(DOCKER_BIN="$tmp/fake-docker" bash scripts/docker-gc.sh 2>/dev/null | grep -c 'prune -a' || true)"
batchAll="$(DOCKER_BIN="$tmp/fake-docker" bash scripts/docker-gc.sh --images-only 2>/dev/null | grep -c 'prune -a' || true)"
check "--old-images prunes unused tagged images older than 7 days" 1 "$oldFlag"
check "the default run never uses prune -a" 0 "$defaultAll"
check "--images-only (between batches) never uses prune -a" 0 "$batchAll"
cronWired="$(grep -c 'docker-gc.sh --old-images' scripts/install-host-cron.sh || true)"
check "the weekly cron runs docker-gc.sh --old-images" 1 "$cronWired"

check "default run trims the build cache" 1 "$full"
check "--images-only leaves the build cache alone" 0 "$images"
check "--images-only still reclaims dangling images" 1 "$imagePrune"

# The caller: between batches must be images-only, and the tail must do the full trim.
between="$(grep -c 'docker-gc.sh --images-only' scripts/rebuild-stale.sh || true)"
tail_trim="$(grep -c 'bash scripts/docker-gc.sh$' scripts/rebuild-stale.sh || true)"
check "rebuild-stale prunes images only between batches" 1 "$between"
check "rebuild-stale trims the build cache once at the end" 1 "$tail_trim"

# HD-9b — the AI web's images. A checkout whose infra/aiweb/docker-compose.yml went through four
# versions: release 1, release 2, release 3, then a comment-only change. Kept: release 3 (pinned
# now), release 2 (the release before, found by walking back past the comment-only commit), the
# image a container uses (release 1's app) and an image whose ID is not its digest but whose
# RepoDigest is pinned (the classic image store). Removed: the rest of that project's images.
d() { printf 'sha256:%064d' "$1"; }
repo="$tmp/repo"
mkdir -p "$repo/infra/aiweb"
pin() { # <app> <migrate> [comment]
  printf 'name: hydromart-ai\n# %s\nservices:\n  db:\n    image: postgres:16-alpine@%s\n  migrate:\n    image: ghcr.io/m0gsy/hydromart-ai@%s\n  aiweb:\n    image: ghcr.io/m0gsy/hydromart-ai@%s\n' \
    "${3:-release}" "$(d 9)" "$2" "$1" > "$repo/infra/aiweb/docker-compose.yml"
  git -C "$repo" -c core.autocrlf=false add -A >/dev/null && git -C "$repo" -c core.autocrlf=false -c user.name=t -c user.email=t@example.invalid commit -qm "$3" >/dev/null
}
git -C "$repo" init -q
pin "$(d 11)" "$(d 12)" one
pin "$(d 21)" "$(d 22)" two
pin "$(d 31)" "$(d 32)" three
pin "$(d 31)" "$(d 32)" "three, comment only"
cat > "$tmp/ai-docker" <<EOF
#!/usr/bin/env bash
printf '%s\n' "\$*" >> "$tmp/ai.log"
case "\$1 \$2" in
  "ps -a") case "\$*" in *Label*) printf 'hydromart\nhydromart-ai\n' ;; *) printf 'c1\nc2\n' ;; esac ;;
  "ps -aq") printf 'c1\nc2\n' ;;
  "inspect --format") printf '%s\n' "$(d 11)" sha256:not-an-ai-image ;;
  "images -q") printf '%s\n' "$(d 11)" "$(d 12)" "$(d 21)" "$(d 22)" "$(d 31)" "$(d 32)" "$(d 41)" "$(d 42)" sha256:classic ;;
  "image inspect")
    id="\${*: -1}"
    case "\$id" in sha256:classic) echo "ghcr.io/m0gsy/hydromart-ai@$(d 22) " ;; *) echo "ghcr.io/m0gsy/hydromart-ai@\$id " ;; esac ;;
esac
exit 0
EOF
chmod +x "$tmp/ai-docker"
: > "$tmp/ai.log"
out="$(DOCKER_BIN="$tmp/ai-docker" GC_INFRA_DIR="$repo/infra" bash scripts/docker-gc.sh --old-images 2>&1)"
removed="$(grep '^rmi ' "$tmp/ai.log" | sed 's/^rmi //' | sort | tr '\n' ' ')"
check "removes only the AI web images neither pinned, nor the release before, nor in use" \
  "$(d 12) $(d 41) $(d 42) " "$removed"
grep -q -- '-f' <<<"$(grep '^rmi ' "$tmp/ai.log")" && check "never forces a removal (rmi -f)" none forced || check "never forces a removal (rmi -f)" none none
case "$out" in
  *"3 removed, 6 kept"*) check "says what it removed and kept" yes yes ;;
  *) check "says what it removed and kept" yes "$out" ;;
esac
: > "$tmp/ai.log"
DOCKER_BIN="$tmp/ai-docker" GC_INFRA_DIR="$repo/infra" bash scripts/docker-gc.sh >/dev/null 2>&1
check "only the weekly --old-images run touches the AI web's images" 0 "$(grep -cE '^(rmi|images) ' "$tmp/ai.log" || true)"
# A checkout with no earlier release (one commit): only the current pins and in-use images stay.
repo1="$tmp/repo1"
mkdir -p "$repo1/infra/aiweb"
git -C "$repo1" init -q
cp "$repo/infra/aiweb/docker-compose.yml" "$repo1/infra/aiweb/"
git -C "$repo1" -c core.autocrlf=false add -A >/dev/null && git -C "$repo1" -c core.autocrlf=false -c user.name=t -c user.email=t@example.invalid commit -qm only >/dev/null
: > "$tmp/ai.log"
out="$(DOCKER_BIN="$tmp/ai-docker" GC_INFRA_DIR="$repo1/infra" bash scripts/docker-gc.sh --old-images 2>&1)"
removed="$(grep '^rmi ' "$tmp/ai.log" | sed 's/^rmi //' | sort | tr '\n' ' ')"
check "with no earlier release in history, only the pinned and in-use images stay" \
  "$(d 12) $(d 21) $(d 22) $(d 41) $(d 42) sha256:classic " "$removed"

# AI-5 — n8n's image is pinned in the same file (n8n and n8n-setup), and kept like the app's: the
# digest pinned now and the one before. Three versions: no n8n yet, n8n 51, then only n8n moved
# to 61. Kept: app 31, migrate 32, n8n 61 (now) and n8n 51 (the release before); removed: n8n 71,
# pinned nowhere.
repo3="$tmp/repo3"
mkdir -p "$repo3/infra/aiweb"
git -C "$repo3" init -q
pin3() { # <n8n digest or empty> <comment>
  {
    printf 'name: hydromart-ai\n# %s\nservices:\n  db:\n    image: postgres:16-alpine@%s\n' "$2" "$(d 9)"
    printf '  migrate:\n    image: ghcr.io/m0gsy/hydromart-ai@%s\n  aiweb:\n    image: ghcr.io/m0gsy/hydromart-ai@%s\n' "$(d 32)" "$(d 31)"
    [ -z "$1" ] || printf '  n8n:\n    image: ghcr.io/m0gsy/hydromart-ai@%s\n  n8n-setup:\n    image: ghcr.io/m0gsy/hydromart-ai@%s\n' "$1" "$1"
  } > "$repo3/infra/aiweb/docker-compose.yml"
  git -C "$repo3" -c core.autocrlf=false add -A >/dev/null && git -C "$repo3" -c core.autocrlf=false -c user.name=t -c user.email=t@example.invalid commit -qm "$2" >/dev/null
}
pin3 '' 'before n8n'
pin3 "$(d 51)" 'n8n arrives'
pin3 "$(d 61)" 'n8n moves alone'
cat > "$tmp/ai-docker3" <<EOF
#!/usr/bin/env bash
printf '%s\n' "\$*" >> "$tmp/ai3.log"
case "\$1 \$2" in
  "ps -a") case "\$*" in *Label*) printf 'hydromart\nhydromart-ai\n' ;; *) printf 'c1\n' ;; esac ;;
  "ps -aq") printf 'c1\n' ;;
  "inspect --format") printf '%s\n' sha256:not-an-ai-image ;;
  "images -q") printf '%s\n' "$(d 31)" "$(d 32)" "$(d 51)" "$(d 61)" "$(d 71)" ;;
  "image inspect") echo "ghcr.io/m0gsy/hydromart-ai@\${*: -1} " ;;
esac
exit 0
EOF
chmod +x "$tmp/ai-docker3"
: > "$tmp/ai3.log"
DOCKER_BIN="$tmp/ai-docker3" GC_INFRA_DIR="$repo3/infra" bash scripts/docker-gc.sh --old-images >/dev/null 2>&1
removed="$(grep '^rmi ' "$tmp/ai3.log" | sed 's/^rmi //' | sort | tr '\n' ' ')"
check "n8n's image: the pinned one and the one before stay, like the app's; one pinned nowhere goes" "$(d 71) " "$removed"

# A compose file that pins no digest (tags only, or no image line at all) has nothing to keep by:
# an empty keep list must never widen the prune to every AI web image no container uses.
for shape in tags none; do
  repo2="$tmp/repo-$shape"
  mkdir -p "$repo2/infra/aiweb"
  git -C "$repo2" init -q
  if [ "$shape" = tags ]; then
    printf 'name: hydromart-ai\nservices:\n  db:\n    image: postgres:16-alpine\n  aiweb:\n    image: ghcr.io/m0gsy/hydromart-ai:latest\n' > "$repo2/infra/aiweb/docker-compose.yml"
  else
    printf 'name: hydromart-ai\nservices:\n  aiweb:\n    build: .\n' > "$repo2/infra/aiweb/docker-compose.yml"
  fi
  git -C "$repo2" -c core.autocrlf=false add -A >/dev/null && git -C "$repo2" -c core.autocrlf=false -c user.name=t -c user.email=t@example.invalid commit -qm "$shape" >/dev/null
  : > "$tmp/ai.log"
  out="$(DOCKER_BIN="$tmp/ai-docker" GC_INFRA_DIR="$repo2/infra" bash scripts/docker-gc.sh --old-images 2>&1)"
  check "a compose file with no digest pin ($shape): no AI web image removed" 0 "$(grep -c '^rmi ' "$tmp/ai.log" || true)"
  case "$out" in
    *"pins no digest; AI web images left alone"*) check "  ...and it says why ($shape)" yes yes ;;
    *) check "  ...and it says why ($shape)" yes "$out" ;;
  esac
done

# Beside a deploy (it holds the stack lock): no AI web image is touched, and the run does not wait.
if command -v flock >/dev/null 2>&1; then
  : > "$tmp/ai.log"
  out="$( (flock 9; DOCKER_BIN="$tmp/ai-docker" GC_INFRA_DIR="$repo/infra" timeout 30 bash scripts/docker-gc.sh --old-images 2>&1) 9>>"$STACK_LOCK")"
  check "while a deploy holds the stack lock: no AI web image removed" 0 "$(grep -c '^rmi ' "$tmp/ai.log" || true)"
  case "$out" in
    *"a deploy holds the stack lock"*) check "  ...and it says so, without waiting" yes yes ;;
    *) check "  ...and it says so, without waiting" yes "$out" ;;
  esac
else
  echo "skip the stack lock held by a deploy: no flock here (it runs on CI)"
fi

rm -rf "$tmp"
exit "$fails"
