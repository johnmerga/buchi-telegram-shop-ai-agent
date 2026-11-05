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

Create the bot with [BotFather](https://t.me/BotFather) by sending `/newbot`, and set
`TELEGRAM_BOT_TOKEN` to the token it returns. Generate `TELEGRAM_WEBHOOK_SECRET` with
`openssl rand -hex 32`.

Telegram delivers updates to `POST /telegram/webhook`. The server stores each update before it
processes it, so Telegram's retries and server restarts never lose or repeat one. After each
deployment URL change, register the webhook:

```sh
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -d "url=https://YOUR_HOST/telegram/webhook" \
  -d "secret_token=$TELEGRAM_WEBHOOK_SECRET"
```

Replace `YOUR_HOST` with the Render host name. For local development, expose port 3000 over HTTPS
with a tunnel such as `cloudflared tunnel --url http://localhost:3000`, and register the tunnel's
host name instead.

### Mini App sign-in

A Mini App sends its Telegram launch data to `POST /auth/mini-app` as `{"initData": "..."}`. The
server checks Telegram's signature with the bot token, rejects launch data older than 24 hours, and
returns a bearer token that is valid for 12 hours. In Render, set `AUTH_TOKEN_SECRET` to a secret of
at least 32 characters, for example from `openssl rand -hex 32`. Changing it signs out every user.

### Gemini and payment checks

Buchi reads payment screenshots with the Gemini API. Create a key in
[Google AI Studio](https://aistudio.google.com/apikey), which needs no payment method, and set
`GEMINI_API_KEY` in Render. The model IDs default to `gemini-2.5-flash-lite`,
`gemini-2.5-flash`, and `gemini-embedding-001`. Check them in AI Studio and override
`GEMINI_MODEL_FAST`, `GEMINI_MODEL_SMART`, and `GEMINI_MODEL_EMBED` if they change.
`GEMINI_REQUESTS_PER_MINUTE` and `GEMINI_REQUESTS_PER_DAY` keep Buchi under the free tier's limits.
When they run out, payment screenshots go to owner review.

Set `RISK_HASH_SECRET` to a secret of at least 32 characters, for example from
`openssl rand -hex 32`. It keys the hashes that identify payers in the shared risk signals.
Changing it makes Buchi forget every earlier signal.

Buchi also checks each receipt on the public Telebirr and CBE receipt pages. These pages are not
official APIs and may block servers outside Ethiopia. When a page cannot be reached, Buchi approves
payments of up to 1,000 birr without the bank check and sends larger ones to owner review.

### cron-job.org

[cron-job.org](https://cron-job.org) calls the scheduled job endpoints, which also keeps the free
Render instance awake. Each job endpoint is `POST /jobs/<name>` and requires the `x-job-secret`
header. The only job so far is `tick`, which runs the timers that are due.

1. Generate a secret of at least 32 characters, for example with `openssl rand -hex 32`.
1. In Render, set `JOB_SECRET` to that secret.
1. In cron-job.org, click **Create cronjob** and set the URL to
   `https://<your-render-service>.onrender.com/jobs/tick`.
1. Set the schedule to every minute.
1. In the **Advanced** tab, set the request method to `POST` and add the header `x-job-secret` with
   the same secret.
1. Save the job. Each run returns a summary such as `{"done":3,"failed":0}`.

A missing or wrong secret returns `401`, and an unknown job name returns `404`.
