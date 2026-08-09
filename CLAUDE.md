# schedule-tracker-domain — Architecture Notes

## Stack decisions

| Layer | Choice | Reason |
|-------|--------|--------|
| GraphQL server | Apollo Server 4 + `expressMiddleware` | User preference; strong ecosystem |
| ORM | Prisma 5 | Matches staystrong-backend; single migration tool |
| Auth | httpOnly cookie, JWT access (15m) + refresh (7d) | Spec requirement; cross-origin cookie setup |
| Passwords | argon2 or bcrypt | Per spec; Phase 2 decision |
| Email | `EmailService` interface; `console` transport in dev, Resend in prod | Swappable transport; Ethereal for testing full flow locally |
| Validation | zod | Per spec |
| DB namespace | `schedule_tracker` PostgreSQL schema | Isolates from staystrong-backend's `public` tables |

## Module layout

```
src/
  index.ts            — dotenv/config import, entry point
  server.ts           — DB connect + httpServer.listen()
  app.ts              — createApp() async; Apollo + Express setup
  config/
    env.ts            — typed env constants (required vars fail fast on startup)
    prisma.ts         — Prisma singleton with global cache
  graphql/
    context.ts        — AppContext interface (req, res, userId)
    typeDefs.ts       — loads all *.graphql SDL files via @graphql-tools/load-files
    schema/           — SDL *.graphql files (source of truth for the API)
    resolvers/
      index.ts        — merges all resolver maps
      {feature}.ts    — one file per feature
  modules/
    {feature}/
      {feature}.service.ts    — business logic; throws Error on failure
      {feature}.resolvers.ts  — GraphQL resolvers; catches and rethrows as GraphQL errors
```

## Database

Prisma with `multiSchema` preview feature. All schedule-tracker tables live in the `schedule_tracker` PostgreSQL schema. The `_prisma_migrations` history table is in `public` (shared with staystrong-backend — non-conflicting; each project only manages its own entries).

Run `CREATE SCHEMA IF NOT EXISTS schedule_tracker;` manually before the first `prisma migrate dev` if Prisma does not create it automatically.

## Schema export

The `npm run schema:export` script referenced in earlier docs does not actually exist (`scripts/export-schema.ts` is missing) — this is stale documentation, not a real workflow. In practice, the UI repo's `npm run codegen` introspects the **live running API** (`${VITE_API_URL}/graphql`, see `codegen.ts` there) rather than a static `schema.graphql` file. There is no separate schema-export step: start this server locally, then run codegen from the UI repo. (That said, the UI's hand-written GraphQL hooks currently use raw `gql` tags with manually-authored TypeScript types, not the generated client — codegen output isn't actually consumed anywhere yet.)

## Auth

- `POST /graphql` mutation `login` → sets `st_access` and `st_refresh` httpOnly cookies (see `src/utils/auth.ts`; `ACCESS_COOKIE`/`REFRESH_COOKIE` constants — not literally named `access_token`/`refresh_token`)
- Middleware in GraphQL context reads the access cookie → attaches `userId` to `AppContext`
- If the access token is expired, checks the refresh cookie, issues a new access cookie, continues
- `SameSite=Lax`, no `Secure`, for local dev; `SameSite=None; Secure` for production (`NODE_ENV=production`) — required because the deployed frontend and backend are on different domains (Netlify + Railway); see the UI repo's CLAUDE.md for why that alone still wasn't enough on iOS
- All resolvers that touch user data call a `requireAuth(ctx)` helper that throws `UNAUTHENTICATED` if `ctx.userId` is absent
- **Password reset** mirrors the email-verification pattern exactly: a dedicated `PasswordResetToken` table (hashed token, 1-hour expiry, single-use via `consumedAt`), `requestPasswordReset(email)` / `resetPassword(token, newPassword)` mutations in `auth.service.ts`. Never reveals whether an email is registered; rate-limited; issuing a new reset link invalidates prior unexpired ones. Doesn't invalidate other active sessions on reset — there's no server-side session store to revoke (stateless JWT cookies).

## Event scheduling model

The core mechanic: **`sortOrder` (a fractional index, see `src/utils/fractional-index.ts`) drives `computedStartsAt` — not the other way around.** This is the single most important thing to understand before touching event code.

`withComputedStartTimes` (`src/utils/recurrence.ts`) groups events by `calendarId` + UTC calendar date of `startsAt`, sorts each group by `sortOrder`, then walks the sequence with a time cursor:
- **Anchored** events (`isAnchored: true`, a fixed-time appointment) always display at their own `startsAt` — sortOrder never changes their time, only where they sit in the walk order (which affects where the cursor lands for events after them).
- **Flexible** events take the cursor's current position as their `computedStartsAt`, then advance the cursor past their own duration. Reordering a flexible event (`reorderEvent` mutation, changes only `sortOrder`) is what actually moves it in time — this is intentional: flexible events cascade around fixed anchors as you drag them past one another.

`reorderEvent` optionally accepts `startsAt` to move an event to a different day *and* reposition it in one atomic write (used by month-view cross-day drag) — this exists specifically because doing those as two separate mutations let an event briefly render with a stale sort key before the second call "caught up", which looked like the reorder undoing itself.

**Day-bucketing gotcha:** grouping by "UTC calendar date of `startsAt`" is not the same as the user's local calendar day. For a timezone ahead of UTC (e.g. IST, UTC+5:30), a fixed-time event set for e.g. 12:30 AM local has a `startsAt` whose UTC date is one day *earlier* than the local day the user actually picked. `quickCreateEvent` handles this correctly by resolving new-event `sortOrder` against an explicit `dayAnchor` (the client's unambiguous `date` field) rather than deriving the day from `startsAt`'s UTC slice — see `resolveSortOrder`'s doc comment in `event.service.ts` and the regression test `event-day-anchor.test.ts` for the full story. This fix is scoped to event *creation*; the underlying UTC-vs-local mismatch is architectural (see Known limitations below) and could theoretically still surface elsewhere.

## Error conventions

- Services throw plain `Error` (or typed subclasses added in Phase 2)
- Resolvers catch and throw `GraphQLError` with a stable `extensions.code`
- Never expose raw DB errors to the client

## CORS

`env.corsOrigins` (comma-separated `CORS_ORIGIN` env var) → applied only to `/graphql`. Never `origin: '*'` alongside `credentials: true`.

## Testing

`npm test` runs Vitest — 50 tests across `crypto`, `fractional-index`, `recurrence`, `auth` (full register→verify→login flow + password reset, against a real Postgres connection via `supertest`), and `event-day-anchor` (the UTC/local day-boundary regression test). No mocking of the database — tests exercise the real running app (`createApp()`) and a real DB. There's no dedicated `event.service` unit-test file beyond that one regression test; most event-logic correctness has so far been verified through manual/Playwright testing from the UI side rather than backend unit tests. Worth filling in if you're touching `event.service.ts` significantly.

## Known limitations

- **UTC vs. local day-boundary mismatch** (see Event scheduling model above): fixed for event *creation*, not architecturally solved. There's no per-user timezone stored or used anywhere (the `User.timezone` column exists in the schema but is an unused stub, always `"UTC"`). If a similar "wrong day" bug ever resurfaces for edits, drag, or recurrence expansion near midnight in a non-UTC timezone, this is the same root cause.
- **Stray migrations**: `prisma/migrations/` contains ~7 early migrations that actually belong to `staystrong-backend` (`init_user`, `add_portfolio_contact`, etc. — different schema, `public` not `schedule_tracker`), left over from sharing a local Postgres instance during initial setup. Deliberately left in place (explicit call — see README) rather than cleaned up, since removing them could disrupt local dev's migration history against that shared database. They're harmless on a fresh production database (Railway) — just create unrelated tables alongside this app's real ones.
- **Recurring events have no creation UI** anywhere in the frontend yet (no `rrule` input in QuickCreate or the edit form) — the recurrence expansion machinery (`expandOccurrences`, `EventException` model, scope-based edit/delete) is fully implemented and tested, but dormant/unreachable through the app as it exists today.

## Running

```bash
npm run dev          # ts-node-dev with hot reload
npm run build        # tsc + copy SDL files to dist/
npm start            # run compiled output
```

## Deployment

Railway, connected to this repo's `main` branch — deploys automatically on push. `railway.json` sets the start command to `npm run railway:start`, which runs `prisma migrate deploy` before `node dist/index.js` on every boot, so schema changes ship automatically with the code that needs them (no separate manual migration step).

`DATABASE_URL` must be a Railway variable **reference** (`${{Postgres.DATABASE_URL}}`) to the project's Postgres plugin, not a pasted connection string — see README for the exact steps. `CORS_ORIGIN` and `APP_URL` must point at the deployed frontend's real origin for cookies/CORS and email links to work; `NODE_ENV=production` must be set for `cookieOptions()` in `src/utils/auth.ts` to switch to `SameSite=None; Secure`, which cross-origin cookie auth requires.

Full production checklist and the stray-migrations caveat are in the README.
