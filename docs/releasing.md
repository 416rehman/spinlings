# Releasing

A release is a `vX.Y.Z` tag on `main`. The tag deploys the server (D1 migrations, then the Worker), and the marketplace entry is then pointed at the tag and its commit, so people only ever install tagged code. The server always goes out before the mod (SPEC 32).

## One-time setup

### GitHub

Do these once, in the settings for `416rehman/spinlings`:

- **Security:** turn on private vulnerability reporting (SECURITY.md links to it), Dependabot alerts and Dependabot security updates.
- **Actions:** set the default workflow token to read-only, require approval for workflows from first-time contributors, and require actions to be pinned to a full-length commit SHA.
- **`main`:** a ruleset that requires a pull request and passing `ci / test` and `ci / plugin` checks, and blocks force-pushes and deletion.
- **Tags:** a ruleset on `v*` that only maintainers can create, and that blocks updates and deletion, so a release tag can never move.
- **Environment `production`:**
  - a required reviewer;
  - deployments limited to tags matching `v*`;
  - two environment secrets (not repository secrets), so pull requests and other workflows never see them: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (the account the Worker and database live in).

### The deploy token

Create `CLOUDFLARE_API_TOKEN` as a **custom token**, not from a template. The "Edit Cloudflare Workers" template also grants Workers Tail (live request logs, which would defeat PRIVACY.md's promise of no request logs), KV, R2 and routes on every zone. Give it exactly:

| Scope | Permission | Why |
|---|---|---|
| Account (this one account only) | Workers Scripts: Edit | `wrangler deploy` |
| Account (this one account only) | D1: Edit | `wrangler d1 migrations apply --remote` |
| Account (this one account only) | Account Settings: Read | only if wrangler says it needs it to read the account |
| Zone: `spinlings.dev` only | Workers Routes: Edit | attaching the custom domain on deploy; leave it out if you attach the domain once by hand (below) |

Leave out Workers Tail, Workers Observability, Logs, KV, R2, Pages and every other zone. Set an expiry (a year at most), note the date here when you rotate it, and rotate it at once if a maintainer leaves or the token may have leaked.

Last rotated: not yet created.

### Cloudflare

Done once by hand, never from CI:

- The D1 database `spinlings` exists, and its id is in `wrangler.jsonc`.
- `SECRET` is set on the Worker, with at least 32 random characters:

  ```sh
  node -e "console.log(crypto.randomBytes(32).toString('base64url'))" | npx wrangler secret put SECRET
  ```

  Rotating it is harmless: it only keys the join counters, which last 24 hours.
- Workers observability, Logpush and Tail Workers stay off (PRIVACY.md promises no request logs). Check the dashboard after any change to `wrangler.jsonc`.
- **Before launch:** once `https://spinlings.dev` serves the Worker, set `"workers_dev": false` in `wrangler.jsonc`, so there is exactly one origin (SPEC 31). The domain is final: passkeys are bound to it forever. If the token has no zone permission, attach the domain once in the dashboard: Workers, then spinlings, then Settings, then Domains & Routes.

## Cutting a release

1. **Bump the version and write the changelog.** In a pull request:
   - set `version` in `plugin/.claude-plugin/plugin.json` to `X.Y.Z`, and the same in `CLIENT_VERSION` (`plugin/hooks/client/remote.ts`) and `SERVER_VERSION` and `LATEST_CLIENT` (`server/src/routes/account.ts`); tests fail until all four agree. Claude Code caches installs by version, so every release needs a new one;
   - raise `MIN_CLIENT` (`server/src/app.ts`) only if older mods truly cannot work any more;
   - add the release to `CHANGELOG.md`, including any compatibility impact and any change to what the mod sends, what the server stores or what other players can see (PRIVACY.md must already say so);
   - record the new mod's requests and responses under `test/compat/fixtures/X.Y.Z/`, so later servers prove they still serve it (SPEC 32). That replay suite does not exist yet: it must, before v0.1.0 ships.

   Merge it once CI passes.

2. **Check the release commit** on an up-to-date `main`:

   ```sh
   npm ci --ignore-scripts
   node --test "test/**/*.test.ts"
   npm run test:plugin
   npm run validate
   npm run e2e
   ```

   Keep the `validate` output; it goes in the release note. `npm run e2e` plays two players through every flow over real HTTP; `npm run e2e -- --d1` does the same on a local D1.

3. **Tag and push:**

   ```sh
   git tag -s vX.Y.Z -m vX.Y.Z
   git push origin vX.Y.Z
   ```

   The `deploy` workflow then:
   - in `verify`, with no secrets and no approval needed: checks that the tag is on `main` and matches the plugin version, runs every test (none may skip), validates the mod and runs its tests, and builds the Worker;
   - in `deploy`, only after `verify` passes: waits for approval in `production`, runs `wrangler d1 migrations apply spinlings --remote`, then `wrangler deploy`;
   - checks that `https://spinlings.dev/v1/health` answers and `/v1/version` reports `X.Y.Z`. A missing `SECRET` answers 503 everywhere, so a deploy without it fails here instead of going green.

   Migrations run while the previous Worker is still serving, and the new server must keep working with the previous release of the mod, because players update when they choose to. So a migration may add tables, columns and indexes, but must not drop or rename anything the live Worker still uses. Remove old things in a later release.

4. **Write the GitHub release** for the tag. The note must have:
   - the `CHANGELOG.md` entry, in plain words;
   - the diff: `https://github.com/416rehman/spinlings/compare/vPREV...vX.Y.Z`;
   - the `npm run validate` output from step 2, in a code block, so anyone can see the hooks and calls of the release.

5. **Point the marketplace at the release.** In a pull request, set the plugin entry's `source` in `.claude-plugin/marketplace.json` to the new tag and its commit:

   ```json
   "source": {
     "source": "git-subdir",
     "url": "https://github.com/416rehman/spinlings.git",
     "path": "plugin",
     "ref": "vX.Y.Z",
     "sha": "<output of: git rev-parse vX.Y.Z^{commit}>"
   }
   ```

   Run `npm run validate`, then merge. Once a tag exists, CI fails until the entry naming it carries its exact commit (`test/release/marketplace.test.ts`), so for the first release, v0.1.0, this pull request is what turns `main` green again. Players get the update with:

   ```sh
   claude plugin marketplace update spinlings
   claude plugin update spinlings@spinlings
   ```

## If something goes wrong

- **A bad Worker deploy:** run `npx wrangler rollback` to go back to the previous Worker version, or re-run the `deploy` workflow for the previous tag. Rolling back the Worker does not undo migrations, which is why they must stay compatible with the previous release.
- **Lost data:** D1 Time Travel can restore the database to a point in the last 30 days (`npx wrangler d1 time-travel restore spinlings --timestamp <time>`). Everything written after that point is lost, and anything deleted since then comes back, including accounts players deleted. Use it only to recover from real data loss.
- **A bad mod release:** point the marketplace entry back at the previous tag and commit, then cut a fixed release. Never move or delete a published tag.
