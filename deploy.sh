#!/usr/bin/env bash
# Build + publish + deploy. Data is no longer baked: the container fetches it
# on boot and again every night, so this only ships code.
set -euo pipefail
cd "$(dirname "$0")"

TAG="${1:-$(date -u +%Y%m%d-%H%M)}"
IMAGE="registry:5000/eaksy-site:${TAG}"

echo "==> regenerating static assets"
node build/genmap.mjs
node build/gentech.mjs

echo "==> building ${IMAGE}"
docker build -t "${IMAGE}" .
docker push "${IMAGE}"

echo "==> deploying"
SITE_TAG="${TAG}" docker stack deploy -c stack.yml --with-registry-auth eaksy
docker service ls --filter name=eaksy_site
