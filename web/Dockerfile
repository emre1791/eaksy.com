# Static site. Data is pulled from the api service at render time.
FROM node:22-alpine
WORKDIR /app
COPY server.mjs ./
COPY public/ ./public/
ENV PORT=8080
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1
USER node
CMD ["node", "server.mjs"]
