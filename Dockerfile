# The Node server (SPEC 33, docs/self-hosting.md): no npm install and no build step, since it has no runtime
# dependencies and Node runs the TypeScript directly. Runs as the image's non-root `node` user with its one SQLite
# file in /data. HTTPS comes from your reverse proxy. Bump the tag and its digest together.
FROM node:22.23.5-alpine3.24@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a

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
