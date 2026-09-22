# Requirements and verification

## User stories

| Story | Implementation | Automated evidence |
| --- | --- | --- |
| Find US packaged or ordinary foods from a name, brand, or barcode | USDA + OFF adapters, source attribution, top-five choices | Provider normalization/cache/failure tests; production source smoke |
| Add a travel food or transcribed nutrition label | Custom product editor, optional nutrients, label gram basis, portions | Desktop/mobile create-food journey; boundary validation |
| Log familiar foods without repeated brand questions | Exact saved matches, confirmed aliases, `remember_choice` | Agent-resolution tests and real MCP client |
| Resolve ambiguity or missing data politely | `choose`, `clarification_required`, structured issues and agent skill | Missing amount/unit/calories, duplicate-name and unknown-weight tests |
| Change recipe amounts for one meal | Template yield plus log-only ingredient overrides | Service recipe tests and desktop/mobile customized-recipe flow |
| Use metric, US mass, volume, or pieces | Exact mass conversion; product-specific volume/portion conversion | Parameterized unit tests and ambiguous-portion rejection |
| Get today/week/month/range intake | User timezone, inclusive local dates, daily trends, unknown-nutrient warnings | Date/range tests; service stats; all period tabs in browser journeys |
| Correct mistaken entries | Date/meal/notes updates; delete/re-log quantities; historic snapshots | Owner-scoped correction/deletion and snapshot tests |
| Retry after a timeout without duplicate meals | Stable key, request fingerprint, atomic insert, deletion tombstones | Concurrent duplicate requests, changed-payload conflict, dropped browser response, deleted-log retry |
| Keep two users' data separate | Owner conditions in every record operation, session remount, user tokens | Cross-account service denial and same-page account-switch browser regression |
| Connect an agent safely | Official SDK Streamable HTTP, hashed revocable tokens, guide resource, skill | SDK Client initialize/list/resource/save/resolve/log/retry/stats pipeline; revocation test |
| Use a phone or keyboard | Responsive grid, native dialog/focus restoration, labeled controls | Mobile/desktop journeys, overflow assertion, keyboard test, axe checks |
| Deploy only verified code | Main-push CI → exact SHA deploy; Vercel Git deployment disabled | Hosted CI and production deploy workflow runs |

## Validation design

Vitest runs business and API scenarios against isolated PGlite databases locally, and the same suite against PostgreSQL 17 in GitHub Actions. The latter exercises the production pool/transaction implementation; schema namespaces isolate concurrent test files. Test database URLs are restricted to loopback. Playwright uses a separately seeded disposable database and no external-provider traffic. Real MCP tests use the official SDK client over an actual listening HTTP server rather than hand-crafted JSON-RPC alone.

`npm run test:coverage` produces line/branch/function measurements and an HTML report; CI retains reports and failed browser diagnostics for 14 days. Coverage is evidence for the exercised scenarios, not a claim that every possible provider record or agent interpretation is correct. Live acceptance uses a temporary account and removes its data afterward, keeping the owner's journal empty.

## Review remediation

The requested independent subagent review found four issues: stale state across account switches; a new key after an uncertain log response; deleted logs losing retry protection; and incomplete products being marked ready. Each was fixed and covered with a targeted regression. Account-owned UI remounts on identity change; log dialogs retain their request key; deletion keeps an inaccessible tombstone; and resolution asks for missing calories. Shared writes also run in a per-user PostgreSQL transaction, including preference writes and recipe-reference checks.

The initial browser checks caught decorative icons being included in accessible button names, select-label matching, dialog focus, and text contrast. Labels/focus were repaired and the muted text palette was darkened. Screenshots are generated for both desktop and mobile journals. Test source and CI artifacts are the authoritative evidence for a particular commit; do not infer current deployment status from this document alone.

An additional browser regression verifies that invalid date ranges clear prior totals and recover when a valid period is selected. An independent Codex agent also performed a fixture-based skill sanity check for a remembered yogurt, ambiguous cereal, a cookie-label image transcription, uncertain retries, and deleted requests. All five passed; this was not a Hermes runtime activation test.
