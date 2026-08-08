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
