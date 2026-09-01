# One-box image. Node 22, non-root, listens on $LISTEN_HOST:$PORT.
# Waffo mode and credentials are supplied by the deployment secret store.
# Never select a provider mode or bake credentials in this file.
FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
# tsx is a devDependency; production start is `node --import tsx src/server.ts`.
RUN npm ci && npm cache clean --force

COPY src ./src
COPY public ./public
COPY tsconfig.json ./

# Fail the image build if the runtime asset used by the public board is absent.
RUN test -s /app/public/icons/bitcoin.svg

RUN mkdir -p /app/data && chown -R node:node /app

USER node

ENV NODE_ENV=production \
    PORT=3000 \
    LISTEN_HOST=0.0.0.0 \
    DATABASE_PATH=/app/data/guest-seat.sqlite

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || '3000') + '/healthz').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "--import", "tsx", "src/server.ts"]
