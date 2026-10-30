# Notivo on a plain server (for example with Coolify), without Cloudflare.
# The database lives in /data; mount a persistent volume there.
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build:portal && npm run build:server

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000 DB_PATH=/data/notivo.db
COPY --from=build /app/build ./build
COPY --from=build /app/portal/dist ./portal/dist
COPY --from=build /app/migrations ./migrations
COPY --from=build /app/node_modules/html-rewriter-wasm ./node_modules/html-rewriter-wasm
# The server runs with plain `node`; npm, npx and corepack only add attack surface.
RUN rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
  && mkdir /data && chown node:node /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -q -O /dev/null http://127.0.0.1:3000/ || exit 1
CMD ["node", "build/server.mjs"]
