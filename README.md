# Calorie Ledger

A private food journal with a responsive web dashboard and authenticated MCP tools for agents such as Hermes. TypeScript, React/Vite, Express, PostgreSQL (Neon), and Vercel. Built for a handful of users, with account isolation and no public signup.

- **App:** https://calorie-ledger-six.vercel.app
- **MCP:** https://calorie-ledger-six.vercel.app/mcp (Streamable HTTP, OAuth or manually created bearer token)
- **Agent skill:** [.agents/skills/calorie-ledger/SKILL.md](.agents/skills/calorie-ledger/SKILL.md), also published at `/agent-skill.md` and summarized in the MCP resource `calorie-ledger://guide`.

## Everyday use

On iPhone, open the app in Safari, choose **Share → Add to Home Screen**, and keep **Open as Web App** enabled if shown. The installed app has its own icon and standalone window, with safe-area spacing for the notch and Home indicator. Internet is required to read or save journal data; offline launches show a reconnect page. The service worker caches only that public fallback page, never account data or OAuth responses. Fingerprinted JS/CSS assets use long-lived browser caching; app navigation stays network-first.

1. Sign in. In **Foods**, search by food name, brand, or barcode. Choose a result and review its label, or add a custom product. Unknown nutrients stay unknown. Nutrition may be entered per any gram weight; it is stored per 100g.
2. Save useful portion conversions: grams per bar, serving, US cup, or another supported unit. Weight converts automatically; volume and pieces require a product-specific conversion. Approximate, clearly labeled portions are supported.
3. In **Dishes**, combine saved products with amounts, units, and recipe yield. Optionally record cooked weight to log the finished dish by weight. Preview nutrition before saving.
4. **Log food** records a product or recipe portion. Recipe ingredients can change for one meal without editing the template. Historic entries retain their original nutrition after product/recipe edits.
5. **Journal** shows today, week to date (Monday start), month to date, or an inclusive custom range. Click an entry to open its closable detail modal. **Edit entry** can change its name, date, meal, notes, amount/unit, and component snapshots (names, grams, calories and all nutrients), including adding/removing components. Nutrition is entered as totals for each component, not per 100g; entry totals are computed from the components. Amount/unit labels do not silently change nutrition: use **Scale components to this amount** for proportional resizing, or override components directly. Changes affect this entry only, preserve its ID and retry key, and reject stale snapshot edits using `expectedRevision` (legacy entries start at 0). Missing-label warnings distinguish incomplete totals from complete intake.
6. **Settings** controls timezone, metric/US defaults, password, and revocable agent tokens. Each token belongs to exactly one user. Manual tokens expire after one year; OAuth connections expire after 90 days and can be reconnected.

## MCP connection

For Claude's custom connector, enter **Calorie Ledger** and `https://calorie-ledger-six.vercel.app/mcp`, enable **Requires sign-in**, and leave **Client ID** and **Client secret** blank. Sign in with your existing Calorie Ledger account and approve access. No public signup is enabled. Revoke the connection under **Settings → Agent tokens** (the name starts with `OAuth:`).

The server implements the published [2026-07-28 MCP protocol](https://modelcontextprotocol.io/specification/2026-07-28) through the official TypeScript SDK v2, with its stateless compatibility path for 2025 clients. OAuth uses protected-resource and authorization-server discovery, public-client dynamic registration, S256 PKCE, explicit consent, resource-bound access tokens, issuer identification, and rotating refresh tokens with replay revocation. Access tokens last one hour, refresh tokens 30 days, and the grant at most 90 days. OAuth credentials work only at `/mcp`. Tokens and codes are stored hashed; serverless requests share durable PostgreSQL state. The SDK v1 auth router supplies standard OAuth endpoint validation; v2 supplies protocol handling. Client ID Metadata Documents are not advertised: clients use the published registration endpoint instead, avoiding arbitrary server-side metadata URL fetching.

Create a token in Settings; copy it once and store it in the agent's secret store. Configure a remote Streamable HTTP server with this endpoint and header (adapt the wrapper to the client's configuration format):

```json
{
  "url": "https://calorie-ledger-six.vercel.app/mcp",
  "headers": { "Authorization": "Bearer YOUR_TOKEN" }
}
```

Install the published skill as `calorie-ledger/SKILL.md` in the calling agent's supported skill directory. The canonical repository copy is under `.agents/skills/`; the public download is generated during builds. Use OAuth for Claude's connector or explicit bearer headers for clients that support them.

The agent interprets free-form messages and images, then sends structured tool arguments. `resolve_food` returns `ready`, `choose`, `not_found`, or `clarification_required`; it never logs automatically. Search and resolution return `preferredProductId` (or null), `matchType` (`confirmed_alias`, `exact_saved`, or `none`), and `requiresProductConfirmation`. When confirmation is false, use the preferred product without repeating the identity question; quantity, portion conversions and calories still need validation. `search_products` returns at most five candidates, retaining alternatives with the preferred saved item first; external lookup follows the `external` flag. `resolve_food` resolves confirmed local matches without external lookup. Explicit `broaden=true` searches ask for a fresh choice even when a preferred item exists. Preserve explicit brand/variant changes in queries and pass requested portion labels separately; ranking alone never authorizes selection. External candidate IDs are previews: save the chosen product first, then remember its confirmed alias. Missing fields return structured issues. Every log requires a stable idempotency key; retry the original key after a timeout. Deleted entries retain tombstones so old retries cannot resurrect them.

## Local development

Use Node 24 and npm. The lockfile pins exact dependencies.

```sh
npm ci
cp .env.example .env.local
# Set DATABASE_URL to a development PostgreSQL database, and APP_URL to the local origin.
node --env-file=.env.local --import tsx scripts/migrate.ts
# Set NEW_USER_PASSWORD securely in the environment, then:
node --env-file=.env.local --import tsx scripts/create-user.ts yourname America/Los_Angeles
node --env-file=.env.local --import tsx server/dev.ts
```

Open http://127.0.0.1:3000. Development and production databases should be separate. Do not use the production database for tests. For a disposable demo with no credentials or external data services, `E2E_TEST=1 npm run dev` creates an in-memory PostgreSQL-compatible database with the test accounts documented in `server/dev.ts`; test mode is forbidden under `NODE_ENV=production`.

```sh
npm run check
npm run test:coverage
npm run test:e2e
# Optional real local PostgreSQL suite (isolated schema per test file):
TEST_DATABASE_URL=postgresql://user:password@127.0.0.1:5432/test npm run test:coverage
```

Playwright tests run against the production frontend build, with disposable data and deterministic external-provider responses. CI also runs the service/API/MCP suite against real PostgreSQL 17. See [test and UX evidence](docs/verification.md).

## Deployment and operations

The private repository has CI, Dependabot, and a production deploy workflow. CI typechecks, tests against PostgreSQL, measures coverage, builds, and runs desktop/mobile browser tests. A successful main-branch **push** CI run deploys its exact tested commit, applies additive migrations, and runs Vercel. The `workflow_run` guard excludes PR runs. Deployment concurrency is serialized. Direct Vercel Git deployments are disabled so they do not bypass CI.

Vercel production variables: `DATABASE_URL`, `APP_URL`. Optional `USDA_API_KEY` increases lookup capacity. GitHub secrets: `DATABASE_URL`, `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`. Secrets never enter the client bundle. Provision infrastructure before CI deployment; schema initialization does not create accounts automatically.

Add users with `scripts/create-user.ts` and a securely supplied `NEW_USER_PASSWORD`; there is no signup endpoint. The initial owner credentials are delivered separately in a gitignored local file. Change the initial password after signing in. Password changes invalidate browser sessions; revoke agent tokens separately in Settings. Database administrators can remove an account with an explicitly scoped user deletion; foreign keys remove its records.

For password recovery, supply `NEW_USER_PASSWORD` securely and run `node --env-file=.env.local --import tsx scripts/reset-password.ts username`. It updates only that account and invalidates its browser sessions. Agent tokens remain separately revocable.

For backups, run `pg_dump --format=custom --file=backup.dump "$DATABASE_URL"` from a secure environment and store the encrypted backup outside the repository. Restore into a separate empty database with `pg_restore` and verify it before changing production connection settings. Never put personal logs or database dumps in CI artifacts. Deployment rollback can use a previous Vercel deployment; migrations are additive, and data restoration is a separate operation. Provider failures are visible but do not block saved foods or custom products.

## Data sources and limitations

USDA FoodData Central supplies US branded and general foods; Open Food Facts supplies US-filtered packaged-food search and barcode lookup. Requests are bounded by timeouts, shared database rate limits, and a 24-hour cache. Without a personal USDA key, the documented `DEMO_KEY` is used with conservative limits (25 requests/hour, 45/day across the app); provider-side limits may be shared. Add a free USDA key in Vercel if search volume grows. A failed source returns a warning while the other source and saved collection remain usable. Search runs on explicit submission, never on every keystroke.

USDA data: https://fdc.nal.usda.gov/ ([API guide](https://fdc.nal.usda.gov/api-guide/)). Open Food Facts data is available under [ODbL](https://opendatacommons.org/licenses/odbl/1-0/); individual contents use [Database Contents License](https://opendatacommons.org/licenses/dbcl/1-0/). Imported records retain their source and source identifier; the UI attributes the providers. No product images are redistributed. Provider records may be incomplete or outdated; verify the package label. Liquid OFF records whose gram basis cannot be trusted are skipped; USDA or a custom label with a gram conversion can be used instead.

This is a food diary, not a medical recommendation engine. It does not infer calories from photographs, fabricate unknown nutrients, prescribe goals, or treat an unlogged day as fasting. Data tables are deliberately small and JSON-backed; per-user writes are serialized inside PostgreSQL transactions to preserve recipe references and log snapshots across serverless instances. There is no local-file production storage or process-memory session state.

## Repository map

| Path | Purpose |
| --- | --- |
| `src/shared.ts` | Validated web/MCP contracts, nutrient and quantity definitions |
| `server/service.ts` | Account-scoped food, dish, log, preference, and stats operations |
| `server/nutrition.ts` | Unit conversion, nutrient math, and date validation |
| `server/search.ts` | Provider adapters, cache, and conservative matching |
| `server/auth.ts` | Password hashing, sessions, tokens, and rate limits |
| `server/app.ts` | Web API and official MCP SDK transport |
| `server/db.ts` | PostgreSQL access, transactions, additive schema |
| `src/App.tsx`, `src/styles.css` | Responsive administrative UI |
| `tests/` | Unit, service, HTTP/MCP, and browser user stories |

Private application code; all rights reserved. Third-party dependencies retain their own licenses.
