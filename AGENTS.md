# Calorie Ledger

Use Node 24 and npm. Shared schemas live in `src/shared.ts`; all web and MCP mutations pass through the same service. Keep user ownership checks at the database boundary. Never print credentials or log request bodies, tokens, or database URLs.

Run `npm run check` and `npm run test:e2e` before publication. Tests use isolated PGlite databases; production requires PostgreSQL. Never point tests at production. Keep production migrations additive and idempotent. New ordinary entries track their sources through indexed dependencies and recalculate atomically on product/dish edits. Preserve legacy entries and manual overrides; never backfill source links by guessing. Reject ambiguous units rather than inventing density or piece size.

Markdown paragraphs stay on one physical line. Keep changes small, but preserve auth, validation, concurrency, and accessibility checks.
