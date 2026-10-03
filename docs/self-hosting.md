# Running your own server

The same server code runs on Cloudflare (a stateless Worker with a D1 database) or on plain Node (`node:http` and the built-in `node:sqlite`), directly or in Docker. Every server is its own world: cards, ratings, handles and trades never move between servers.

Running a server means holding other people's game data, so read [What you owe your players](#what-you-owe-your-players) before you invite anyone.

**Pick your address first.** Passkeys are bound to the server's domain forever, and every link the server makes is built from it, so choose the https address your players will use before anyone saves a passkey. Moving later invalidates every passkey.

## Cloudflare

You need a Cloudflare account and Node 22.18 or later.

1. **Get the code and the pinned tooling.** Always install with `--ignore-scripts` (the repository's `.npmrc` also turns install scripts off); nothing here needs an install script.

   ```sh
   git clone https://github.com/416rehman/spinlings && cd spinlings
   npm ci --ignore-scripts
   npx wrangler login
   ```

2. **Point `wrangler.jsonc` at your account.** It is set up for `spinlings.dev`, and Wrangler uses its `account_id` before your login, so set `account_id` to your own first (`npx wrangler whoami` shows it).

3. **Create the database, then make the rest of `wrangler.jsonc` yours.**

   ```sh
   npx wrangler d1 create spinlings
   ```

   Then change:
   - `database_id` to the id it printed;
   - `vars.ORIGIN` to your server's https address, such as `https://cards.example.org`. It is the passkey domain, and every link is built from it;
   - `routes` to your domain, as `[{ "pattern": "cards.example.org", "custom_domain": true }]`, keeping `workers_dev` at `false` so there is only one address. To serve from `workers.dev` instead, remove `routes`, set `workers_dev` to `true`, and set `ORIGIN` to the `https://spinlings.<your-subdomain>.workers.dev` address `wrangler deploy` prints.

   Leave `observability` and `logpush` off.

4. **Set the secret.** `SECRET` keys the hash the server uses to limit joins per network (see [PRIVACY.md](../PRIVACY.md)). It must be at least 32 characters, and the server answers nothing but "not set up yet" without it. Piping it in keeps it out of your shell history:

   ```sh
   node -e "console.log(crypto.randomBytes(32).toString('base64url'))" | npx wrangler secret put SECRET
   ```

5. **Create the tables, then deploy.**

   ```sh
   npx wrangler d1 migrations apply spinlings --remote
   npx wrangler deploy
   ```

   The config also sets up an hourly cron trigger that deletes expired data on the schedule in [PRIVACY.md](../PRIVACY.md), so keep it. (On Node, the server runs the same sweep every hour.) Check that `https://your.host/v1/health` answers `{"ok":true}`.

**Updating.** Pull the new release, then apply any new migrations before deploying the new code:

```sh
git pull && npm ci --ignore-scripts
npm run deploy        # d1 migrations apply --remote, then wrangler deploy
```

**Local development** against a local D1: put `SECRET=<32+ random characters>` in a `.dev.vars` file (it is git-ignored), then run `npm run dev:worker`.

## Node

You need Node 22.18 or later. It runs the TypeScript directly, and there is nothing else to install. The server applies the SQL migrations in `server/migrations/` when it starts.

```sh
git clone https://github.com/416rehman/spinlings && cd spinlings
SECRET="$(node -e "console.log(crypto.randomBytes(32).toString('base64url'))")" npm run dev:server
```

That serves `http://localhost:8787`, with its data in `server/data/spinlings.db`. Settings are environment variables, listed at the top of `server/src/node.ts`:

| Variable | Meaning |
|---|---|
| `SECRET` | The join-limit key, 32 or more characters. Without it the server makes a random one for each run and warns; with `NODE_ENV=production` it refuses to start. |
| `ORIGIN` (or `PUBLIC_URL`) | The https address players reach the server at. Links are built from it, never from the `Host` header, and it is the passkey domain. Default `http://localhost:PORT`. |
| `SPINLINGS_DB` | The database file (default `server/data/spinlings.db`) |
| `PORT` | The port (default 8787) |
| `HOST` | The listen address (default `127.0.0.1`) |
| `TRUST_PROXY` | How many reverse proxies sit in front (default 0); the client address is then read from `X-Forwarded-For` |
| `POW_DIFFICULTY` | Proof-of-work bits for joining (default 18) |

**Serving other people.** The mod accepts plain http only for `localhost` and `127.0.0.1`, so anyone else needs https. Keep `HOST` at `127.0.0.1`, put the server behind an https reverse proxy, and set `NODE_ENV=production`, a fixed `SECRET`, `ORIGIN` to the https address and `TRUST_PROXY=1`.

**Backups.** The database is one SQLite file. Copy it while the server is stopped, or use SQLite's online backup.

## Docker

The `Dockerfile` runs the same Node server from a `node:22-alpine` image pinned by digest, as a non-root user, with no npm install. It keeps its database in the `/data` volume and listens on port 8787 inside the container:

```sh
docker build -t spinlings .
docker run -d --name spinlings --restart unless-stopped \
  -e SECRET="$(node -e "console.log(crypto.randomBytes(32).toString('base64url'))")" \
  -e ORIGIN=https://cards.example.org -e TRUST_PROXY=1 \
  -v spinlings-data:/data -p 127.0.0.1:8787:8787 spinlings
```

A new `SECRET` when you recreate the container is harmless: it only keys the join counters, which last 24 hours. Publish the port on `127.0.0.1` only, and put your https reverse proxy in front.

## Drops

Drops (promo codes, SPEC 25) have no admin API. You create them on your own machine with `scripts/admin/drop.ts`, which writes the database directly. Always name the database:

```sh
node scripts/admin/drop.ts list --local --db server/data/spinlings.db   # a Node server's SQLite file
node scripts/admin/drop.ts list --d1 spinlings                          # your Cloudflare D1, with your wrangler login
```

The top of the script lists every option. Codes are printed once; unique codes are stored only as hashes.

## Pointing the mod at your server

Your players run `/spin server https://your.host` in Claude Code, or set the **Server URL** option with `/plugin configure spinlings@spinlings`. The mod shows them a one-time notice that this is a community server run by someone else, then talks to that host and no other. Their account on each server is separate, so they start fresh, and `/spin server default` takes them back to `https://spinlings.dev`. The pane header and `/spin privacy` always show which server they are on.

## What you owe your players

The code keeps the promises in [PRIVACY.md](../PRIVACY.md). Keep them too:

- **No request logs.** Leave Cloudflare Workers observability, Logpush and Tail Workers off; the config in this repository does. On Node or Docker, make sure your reverse proxy does not write access logs with addresses or URLs. Gift links contain secret codes.
- **Keep `SECRET` secret.** Anyone with it could test guesses against the join counters, which hold the only trace of an address. Those counters are deleted after 24 hours anyway.
- **Do not add analytics, trackers or third-party requests** to the pages or the API.
- **Say who runs the server.** Your players are trusting you, not this repository.
