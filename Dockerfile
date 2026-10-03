# The Node server (SPEC 33, docs/self-hosting.md): no npm install and no build step, since it has no runtime
# dependencies and Node runs the TypeScript directly. Runs as the image's non-root `node` user with its one SQLite
# file in /data. HTTPS comes from your reverse proxy. Bump the tag and its digest together.
FROM node:22.23.3-alpine3.24@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402

ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787 SPINLINGS_DB=/data/spinlings.db
WORKDIR /app
COPY package.json ./
COPY plugin/hooks plugin/hooks
COPY server server
RUN mkdir /data && chown node:node /data

USER node
VOLUME /data
EXPOSE 8787
CMD ["node", "server/src/node.ts"]
