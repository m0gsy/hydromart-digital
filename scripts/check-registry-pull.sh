#!/usr/bin/env bash
# G6. Prove the box can PULL what CI pushes, before a deploy depends on it.
#
# `IMAGE_PREFIX` flips the production stack from "build every image here" to "pull the
# images CI already built". That flip is one line in `.env`, and the first thing that finds
# out whether it works is a deploy — at which point half the services are on new images and
# the rest cannot start. So this asks the question separately, on the box, changing nothing.
#
#   bash scripts/check-registry-pull.sh                       # uses IMAGE_PREFIX/IMAGE_TAG from .env
#   IMAGE_PREFIX=ghcr.io/m0gsy/hydromart- IMAGE_TAG=sha-abc bash scripts/check-registry-pull.sh
#
# Read-only: it pulls one image and removes it again if it was not already there. It never
# touches a running container, an env file, or the compose stack.
set -euo pipefail

cd "$(dirname "$0")/.."

# shellcheck source=lib/deploy-common.sh
. scripts/lib/deploy-common.sh

PROBE_SERVICE="${PROBE_SERVICE:-auth}"

if [ -z "${IMAGE_PREFIX:-}" ]; then
  echo "IMAGE_PREFIX is empty — the box is in build-locally mode."
  echo "Nothing to verify yet. Set it (or pass it here) to test the registry path first:"
  echo "  IMAGE_PREFIX=ghcr.io/<owner>/hydromart- IMAGE_TAG=<sha> bash scripts/check-registry-pull.sh"
  exit 0
fi

TAG="${IMAGE_TAG:-}"
if [ -z "$TAG" ]; then
  echo "IMAGE_TAG is empty. A pull test without a tag would test ':latest', which the"
  echo "deploy never uses. Pass the SHA tag CI pushed."
  exit 1
fi

IMAGE="${IMAGE_PREFIX}${PROBE_SERVICE}:${TAG}"
echo "Probing $IMAGE"

HAD_IT=no
if docker image inspect "$IMAGE" >/dev/null 2>&1; then
  HAD_IT=yes
fi

if docker pull "$IMAGE"; then
  echo
  echo "OK — the box can pull from this registry."
  docker image inspect "$IMAGE" --format 'digest: {{index .RepoDigests 0}}' 2>/dev/null || true
  # Leave the box exactly as it was found.
  if [ "$HAD_IT" = no ]; then
    docker image rm "$IMAGE" >/dev/null 2>&1 || true
    echo "(removed again — this probe leaves nothing behind)"
  fi
  exit 0
fi

echo
echo "FAILED to pull $IMAGE. The three reasons, in the order they actually happen:"
echo "  1. The box is not logged in:   docker login ghcr.io -u <user> --password-stdin"
echo "     (a GHCR package is private by default, and an anonymous pull of a private"
echo "      package answers 'denied', not 'unauthorized' — it reads like the wrong name)"
echo "  2. The tag does not exist: check the images workflow actually pushed this SHA."
echo "  3. IMAGE_PREFIX has the wrong shape. It is a PREFIX, so it ends with the"
echo "     separator: ghcr.io/<owner>/hydromart-  (trailing dash, no service name)"
exit 1
