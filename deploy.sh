#!/usr/bin/env bash
# Build + publish + deploy both services. No data is baked: the api fetches on
# boot and again every night, and web renders from whatever the api has.
set -euo pipefail
cd "$(dirname "$0")"

TAG="${1:-$(date -u +%Y%m%d-%H%M)}"

echo "==> regenerating static assets"
node web/build/genmap.mjs
node web/build/gentech.mjs

for svc in api web; do
  echo "==> building ${svc}"
  docker build -t "registry:5000/eaksy-${svc}:${TAG}" "${svc}"
  docker push "registry:5000/eaksy-${svc}:${TAG}"
done

echo "==> deploying"
SITE_TAG="${TAG}" docker stack deploy -c stack.yml --with-registry-auth eaksy
docker service ls --filter name=eaksy
