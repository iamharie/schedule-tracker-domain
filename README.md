# schedule-tracker-domain

GraphQL API server for Schedule Tracker — a mobile-first calendar web app.

## Stack

- Node.js + Express 5
- Apollo Server 4 (GraphQL, schema-first SDL)
- Prisma 5 (PostgreSQL, `schedule_tracker` schema)
- TypeScript (strict)

## Running locally

```bash
# 1. Install dependencies
npm install

# 2. Create .env from the example and fill in values
cp .env.example .env

# 3. Run migrations (Phase 2+)
npx prisma migrate dev

# 4. Start dev server
npm run dev
```

GraphQL endpoint: `http://localhost:4000/graphql`  
Health check: `GET http://localhost:4000/health`

## Other commands

```bash
npm run build          # Compile TypeScript + copy SDL files to dist/
npm start              # Run compiled output
npm run schema:export  # Write schema.graphql at repo root (for UI codegen)
npx prisma studio      # Browse the database
```

## Environment variables

See `.env.example` for all required variables. The `DATABASE_URL` must point to the same PostgreSQL instance as `staystrong-backend`.

## Deployment (Railway)

Deployed via Railway's GitHub integration — push to `main` and it redeploys automatically. Config lives in `railway.json` (start command) and `package.json`'s `railway:start` script (`prisma migrate deploy && node dist/index.js` — applies pending migrations before every boot).

**One-time setup for a new environment:**

1. Create a Railway project, connect this repo, add a Postgres plugin.
2. Link the database: in the app service's Variables tab, set `DATABASE_URL` to a **reference**, not a pasted value — type `${{` in the value field and pick the Postgres service's `DATABASE_URL`. It should read `${{Postgres.DATABASE_URL}}` (or whatever your plugin is named). A literal pasted connection string will point at `localhost` and fail with `P1001`.
3. Set the remaining variables (see `.env.example`): `NODE_ENV=production`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` (generate with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`, run twice for two different values), `EMAIL_TRANSPORT=resend`, `RESEND_API_KEY`, `EMAIL_FROM`.
4. Once the frontend is deployed, set `CORS_ORIGIN` and `APP_URL` to its real URL (comma-separate multiple origins in `CORS_ORIGIN`, e.g. to also keep local dev working).

**Finding your data:** Railway's database browser defaults to the `public` schema. This app's tables all live in `schedule_tracker` (see `prisma/schema.prisma`'s `@@schema` directives) — switch schemas in the UI, or query `schedule_tracker.users` etc. directly.

**Known quirk, left as-is:** `prisma/migrations/` contains several early migrations (`init_user`, `add_portfolio_contact`, etc.) that actually belong to `staystrong-backend`, from when this project's Phase 1 setup shared a local Postgres instance with that project. They're harmless on a fresh Railway database (just create unrelated `public.User`/`public.PortfolioContact` tables alongside this app's real `schedule_tracker.*` tables) but are not this project's own migrations.
