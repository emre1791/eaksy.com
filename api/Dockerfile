# Fetches github and roblox on a schedule and serves the cached result.
# Nothing else in the system talks to those upstreams.
FROM node:22-alpine
WORKDIR /app
COPY server.mjs config.json ./
COPY lib/ ./lib/
RUN mkdir -p /app/cache && chown -R node:node /app/cache
ENV PORT=8080 CACHE_DIR=/app/cache
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=45s \
  CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1
USER node
CMD ["node", "server.mjs"]
