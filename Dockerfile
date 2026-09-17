# The site is static; the only reason for a runtime is the sub-path mount.
FROM node:22-alpine
WORKDIR /app
COPY server.mjs ./
COPY src/ ./public/
ENV PORT=8080
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:8080/ >/dev/null || exit 1
USER node
CMD ["node", "server.mjs"]
