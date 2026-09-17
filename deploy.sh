#!/usr/bin/env bash
# Build + publish + deploy the site. Data is baked into the image, so a content
# refresh is just another run of this.
set -euo pipefail
cd "$(dirname "$0")"

TAG="${1:-$(date -u +%Y%m%d-%H%M)}"
IMAGE="registry:5000/eaksy-site:${TAG}"

echo "==> refreshing data"
node build/genmap.mjs
node build/gentech.mjs
node build/fetchdata.mjs

echo "==> building ${IMAGE}"
docker build -t "${IMAGE}" .
docker push "${IMAGE}"

echo "==> deploying"
SITE_TAG="${TAG}" docker stack deploy -c stack.yml --with-registry-auth eaksy
docker service ls --filter name=eaksy_site
