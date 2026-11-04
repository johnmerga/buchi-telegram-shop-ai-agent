# ቡቺ (Buchi)

Buchi is an AI shop admin for Ethiopian retailers who sell through Telegram channels. Three AI
agents answer customers, negotiate prices, take orders, check payment screenshots, and manage
deliveries, and an owner assistant turns the owner's instructions into rules. For the full design, see
[SOLUTION_DESIGN.md](docs/SOLUTION_DESIGN.md). For the build order and engineering rules, see
[PLAN.md](docs/PLAN.md).

## Requirements

- Node.js 22.12 or later
- pnpm, through [Corepack](https://nodejs.org/api/corepack.html), which ships with Node.js
- Docker, for the local Postgres database

## Local setup

1. Enable Corepack, so that `pnpm` uses the version pinned in `package.json`:

   ```sh
   corepack enable
   ```

1. Install the dependencies:

   ```sh
   pnpm install
   ```

1. Create your local environment file:

   ```sh
   cp .env.example .env
   ```

1. Start Postgres with `pgvector`:

   ```sh
   docker compose up -d
   ```

1. Apply the database migrations:

   ```sh
   pnpm --filter @buchi/server db:migrate
   ```

1. Start the server in watch mode:

   ```sh
   pnpm --filter @buchi/server dev
   ```

   The server listens on port 3000. To check that it runs, open `http://localhost:3000/health`.

## Development commands

Run these commands from the repository root.

| Command             | Description                                |
| ------------------- | ------------------------------------------ |
| `pnpm lint`         | Lints every package with ESLint.           |
| `pnpm format`       | Formats every file with Prettier.          |
| `pnpm format:check` | Checks formatting without changing files.  |
| `pnpm typecheck`    | Type-checks every package with TypeScript. |
| `pnpm test`         | Runs every test with Vitest.               |

GitHub Actions runs `format:check`, `lint`, `typecheck`, `test`, and the server build on every pull
request and every push to `main`. The workflow is in
[`.github/workflows/ci.yml`](.github/workflows/ci.yml).

## Deployment

Every service in this section has a free tier that needs no payment method.

### Render

Buchi runs as one Render web service, defined in the [`render.yaml`](render.yaml) Blueprint.

1. In the Render Dashboard, click **New > Blueprint**.
1. Connect this repository and select the `main` branch.
1. Review the `buchi` service and click **Deploy Blueprint**.

After the first deploy, Render deploys each push to `main` after its CI checks pass. Render checks
`GET /health` before it switches traffic to a new deploy.

To protect `main`, add a branch protection rule in GitHub that requires the `check` status check to
pass before a pull request merges.

### Supabase

Production uses a Supabase Postgres database. In Render, set `DATABASE_URL` to the Supabase
transaction pooler connection string (port 6543). The start command runs pending migrations before
the server starts. The first migration enables `pgvector` and creates the `app_user` role that
row-level security applies to.

Integration tests use their own database, which they drop and recreate on every run. Set
`TEST_DATABASE_URL` to change it from the default `postgres://buchi:buchi@localhost:5432/buchi_test`.

### Telegram bot

You create the bot with [BotFather](https://t.me/BotFather) by sending `/newbot`. The server doesn't
read a bot token yet. Task 0.5 adds the webhook route and the environment variables it
needs.

### cron-job.org

[cron-job.org](https://cron-job.org) calls the scheduled job endpoints, which also keeps the free
Render instance awake. No job endpoints exist yet. Task 0.6 adds the tick endpoint and its secret
header.
