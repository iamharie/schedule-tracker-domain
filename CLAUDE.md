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

Run `npm run schema:export` to write `schema.graphql` at the repo root. The UI repo runs `npm run codegen` against this file (requires the API to be running). This is the single source of truth — never hand-edit types in the UI repo.

## Auth (Phase 2)

- `POST /graphql` mutation `login` → sets `access_token` and `refresh_token` httpOnly cookies
- Middleware in GraphQL context reads `access_token` cookie → attaches `userId` to `AppContext`
- If access token is expired, checks `refresh_token`, issues a new access token cookie, continues
- `SameSite=Lax` + no `Secure` for local dev; `SameSite=None; Secure` for production (HTTPS required)
- All resolvers that touch user data call a `requireAuth(ctx)` helper that throws `UNAUTHENTICATED` if `ctx.userId` is absent

## Error conventions

- Services throw plain `Error` (or typed subclasses added in Phase 2)
- Resolvers catch and throw `GraphQLError` with a stable `extensions.code`
- Never expose raw DB errors to the client

## CORS

`env.corsOrigins` (comma-separated `CORS_ORIGIN` env var) → applied only to `/graphql`. Never `origin: '*'` alongside `credentials: true`.

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
