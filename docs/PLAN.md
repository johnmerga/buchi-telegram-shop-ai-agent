# Buchi implementation plan

This plan turns [SOLUTION_DESIGN.md](SOLUTION_DESIGN.md) into phases and task cards that one or
more agents can pick up independently. The design doc is the source of truth for behavior. This
plan is the source of truth for structure, order, and engineering rules.

## How to use this plan

1. Read [Engineering rules](#engineering-rules) and [Repository layout](#repository-layout) before
   you write any code.
2. Pick a task whose dependencies are done. Each task card lists its doc sections, deliverables,
   and acceptance criteria.
3. Work on a branch named `task/<ID>-<short-name>`, for example `task/3.2-receipt-rules`.
4. Open one pull request per task. The pull request is done when every item in
   [Definition of done](#definition-of-done) holds.
5. Do not build anything that no task card asks for. If a task needs something that is missing,
   add a task card to this plan in the same pull request and explain why.

## Decisions

The following decisions apply to every task. Changing one needs an update to this section first.

| Topic | Decision | Reason |
| --- | --- | --- |
| Runtime | Node.js 22 LTS | Node.js 20 reached end of life in April 2026. The design doc's stack table needs the same update. |
| Package manager | pnpm workspaces | One lockfile, shared TypeScript config, and fast installs in CI. |
| Language | TypeScript `strict`, ES modules | Type errors fail the build. |
| Backend | Express 5, grammY, Drizzle ORM, `zod`, `pino` | As in the design doc. `pino` gives structured logs. |
| Frontend | React 19, Vite, Tailwind CSS, shadcn/ui, TanStack Query, React Router, Leaflet | One app, one bundle entry per role. |
| Database | Supabase Postgres with `pgvector` in production. Local development uses Postgres from `docker-compose.yml` with the `pgvector/pgvector` image, and CI uses the same image. | Same SQL everywhere. |
| Code organization | One monorepo at `/data/projects/buchi`: `apps/server`, `apps/web`, `packages/shared`, `evals`, and `docs`. It deploys as one Render service, where the server also serves the built web app. | One install, one CI pipeline, and types shared between the server and the web app. |
| Shop data isolation | One database. Every shop-owned row has `shop_id`, and Postgres row-level security returns only the current shop's rows. Only fraud (`payment_refs`, `risk_signals`), traffic, timer, session, and Telegram update tables are platform-wide. The generic row-level security test lists them explicitly. | Separation is enforced by the database, even if a query forgets its filter. |
| Money | Birr with exactly two decimals, such as `100.00` and `12.23`. Postgres stores `numeric(12,2)`, the API sends strings such as `"12.23"`, and a small `Money` type does all arithmetic without JavaScript floating-point numbers. | Exact amounts. JavaScript numbers cannot hold `0.1 + 0.2` exactly, which breaks checks such as "the payment equals the order total". |
| Time | `timestamptz` in UTC. Display and schedules in `Africa/Addis_Ababa`. | One rule for every table. |
| API auth | Short-lived bearer token (signed JWT) for Mini Apps and the browser | Mini Apps run in an iframe on Telegram Web, where cookies are third-party and can be blocked. |
| Live updates | SSE read with `fetch` streaming | `EventSource` cannot send the bearer token. |
| Gemini models | Model IDs come from environment variables (`GEMINI_MODEL_FAST`, `GEMINI_MODEL_SMART`, `GEMINI_MODEL_EMBED`) | Model names change, code does not. |
| Telegram ingress | Webhook with Telegram's secret-token header. Each update is stored, then processed by an in-process worker. | Fast acknowledgment, deduplication, and replay after a restart. |
| Domain events | An in-process event bus that publishes after the transaction commits | One Render instance, so no message broker is needed. Audit history stays in `order_events`. |

## Engineering rules

Reviewers check every pull request against these rules.

### Structure

- **One responsibility per file.** A module has at most these files, each with one job:
  `*.routes.ts` (HTTP), `*.handlers.ts` (Telegram), `*.service.ts` (use cases and transactions),
  `*.repo.ts` (database access), `*.domain.ts` (pure logic), and `*.schemas.ts` (`zod` schemas).
  Create a file only when the module needs it.
- **Dependencies point inward.** Routes and handlers call services. Services call repos, domain
  functions, and integration clients. Domain files import nothing that does I/O.
- **Modules talk through services.** A module never imports another module's repo or tables
  directly.
- **External services sit behind small interfaces** in `integrations/`, so tests use fakes. Only
  external services get interfaces. Internal code uses plain functions and classes.
- **Pass dependencies through constructors or parameters.** No module-level singletons except
  `config` and `logger`.

### Code

- No `any`, no non-null assertions (`!`), and no type casts without a comment that explains why.
- Store scalar JSON values in `jsonb` columns wrapped as `{ value }`, because the driver parses a
  bare JSON string twice on read.
- Validate every boundary with `zod`: environment variables, HTTP bodies, Telegram payloads, Gemini
  outputs, and external API responses.
- Errors are `AppError` instances with a code. Never swallow an error. Log it once, where it is
  handled.
- No dead code, no commented-out code, no unused exports, and no options that nothing uses.
- No `TODO` without a task ID from this plan.
- Comments explain why, never what. Names explain what.
- Keep functions short and files under about 300 lines. Split by responsibility, not by size alone.
- Every new dependency needs one line in the pull request that says why existing code or the
  platform cannot do the job.

### Data and security

- Every shop-owned query runs inside `withShop(shopId, fn)`, which sets the row-level security
  context. Code outside `db/` never opens a transaction by hand.
- Stock, order status, and payment changes go only through `OrderService` and `PaymentService`.
- Secrets come only from environment variables. Logs never contain phone numbers, receipt images,
  tokens, or raw Telegram `initData`.
- Every agent tool call goes through the tool registry and the policy guard. No agent code calls a
  service that changes data directly.

### Tests

- Every `*.domain.ts` file has unit tests that cover each branch.
- Every repo and every row-level security policy has an integration test against Postgres.
- Every agent tool has a test with a fake Gemini client.
- Tests describe behavior, for example `rejects a price below the lowest price`, not
  `test offer_price 2`.

## Repository layout

```text
buchi/
  apps/
    server/
      src/
        config/          env.ts (zod-validated), logger.ts
        db/              client.ts, with-shop.ts, schema/<domain>.ts, migrations/
        http/            app.ts, caller.ts, validate.ts, middleware/ (auth, shop owner, errors, secret header)
        telegram/        bot.ts, ingress.ts (store and dedupe), worker.ts, actor.ts, keyboards.ts
        modules/
          shops/  catalog/  customers/  orders/  payments/  delivery/  drivers/  owner/  sales/
          demand/  jobs/  reports/
        ai/              gemini.ts, quota.ts, registry.ts, runtime.ts, guard/, prompts/, agents/sales/
        integrations/    ors.ts, nominatim.ts, quickchart.ts, sheets.ts, receipts/
        shared/          errors.ts, money.ts, time.ts, events.ts
      test/              integration tests and fakes
    web/
      src/
        roles/           customer/, driver/, owner/ (one entry point each)
        components/      shared UI, including shadcn/ui
        lib/             api.ts, auth.ts, telegram.ts, sse.ts
  packages/
    shared/              API schemas and enums that both apps import
  evals/
    cli.ts  suites.ts  baseline.json  harness/  runners/  datasets/  recordings/
  docs/
    SOLUTION_DESIGN.md  PLAN.md  architecture.png
```

## Phases and parallel tracks

```text
Phase 0 Foundations ──► Phase 1 Commerce core ──┬─► Track A: 2 AI platform ─► 4 Sales agent ─► 6 Operations agent ─► 7 Owner assistant
                                                ├─► Track B: 3 Payments and fraud (needs 2.1)
                                                ├─► Track C: 5 Delivery (5.6 needs 2.3)
                                                └─► Track D: 8 Frontend (needs each module's API schemas)
All tracks ──► Phase 9 Jobs and reports ──► Phase 10 Evaluation, hardening, and demo
```

Phases 0 and 1 run with one agent, because they set the patterns that every later task copies.
After Phase 1, up to four agents can work in parallel, one per track.

---

## Phase 0: Foundations

Exit criteria: the bot answers `/start` on Render through the webhook, the tick endpoint runs a
test timer, migrations run on Supabase, and CI is green.

### 0.1 Repository and tooling

- **Deliverables:** pnpm workspace, shared `tsconfig.base.json`, ESLint with `typescript-eslint`
  strict rules and import-boundary rules, Prettier, Vitest, `.editorconfig`, `.gitignore` (with
  `.env`), `.env.example`, `docker-compose.yml` with Postgres and `pgvector`, and a pull request template
  that contains the definition of done.
- **Acceptance:** `docker compose up -d` starts Postgres with `pgvector`. `pnpm lint`,
  `pnpm typecheck`, and `pnpm test` pass on an empty project. An import from a domain file into a
  repo file fails lint.

### 0.2 Shared package

- **Deliverables:** `packages/shared` with the enums from the design doc (`OrderStatus`,
  `DeliveryType`, `PricingMode`, `AutonomyLevel`, `ActorRole`) and the `Money` schema, which accepts
  only birr strings with at most two decimals.
- **Acceptance:** both apps import from `@buchi/shared`. Enums match the state machine in the design
  doc.

### 0.3 Server skeleton

- **Deliverables:** `config/env.ts`, `config/logger.ts`, the Express app, error middleware that maps
  `AppError` codes to HTTP statuses, `GET /health`, request IDs, and graceful shutdown.
- **Acceptance:** the server refuses to start with a missing variable and names it. An unknown
  error returns 500 without a stack trace.

### 0.4 Database schema, migrations, and row-level security

- **Doc:** Tech stack and data model, Multi-shop data isolation.
- **Deliverables:** Drizzle client for the Supabase transaction pooler; a setup migration that
  enables `pgvector` and creates the `app_user` role without `BYPASSRLS`; the `shopIsolation`
  policy helper; `withShop(shopId, fn)`, which sets `app.shop_id` and switches to `app_user` for
  the transaction; the `shops` and `shop_members` tables; a migration runner for development and
  production; and an integration test setup that recreates a test database on every run.
- **Scope rule:** each later task adds the tables it needs, with its own migration. Columns are
  not created before a task uses them. The demo seed belongs to Task 1.2.
- **Acceptance:** a generic test fails for any table with a `shop_id` column that lacks row-level
  security and a policy. Inside `withShop`, a shop reads only its own rows and cannot write rows for
  another shop. With no shop set, `app_user` reads nothing.

### 0.5 Telegram ingress

- **Doc:** Design principles (idempotent), Sign-in.
- **Deliverables:** webhook route that checks the secret-token header, stores the update in
  `telegram_updates`, and acknowledges; a worker that processes stored updates in order and
  reprocesses unfinished ones after a restart; actor resolution (customer, driver, or owner) from
  the Telegram user ID.
- **Acceptance:** sending the same update twice processes it once. A request without the secret
  returns 401.

### 0.6 Timers and job endpoints

- **Doc:** Scheduled jobs.
- **Deliverables:** `timers` repo that claims due rows with `FOR UPDATE SKIP LOCKED`, a timer handler
  registry, `POST /jobs/tick`, and `POST /jobs/:name` protected by the job secret header.
- **Acceptance:** two concurrent ticks never run the same timer. A failing handler marks its timer
  failed and does not block the others.
- **Rule for every later handler:** error messages contain no personal data, because they are logged
  and stored in `last_error`.
- **Rule for scheduling:** a timer is scheduled in the same transaction as the change it guards
  (`TimerService.schedule(tx, ...)`). A handler whose entity has moved on finishes as `done`, not
  `failed`.

### 0.7 CI and deployment

- **Deliverables:** GitHub Actions workflow (lint, typecheck, unit tests, integration tests with a
  `pgvector` service container), `render.yaml`, and a README section for the Supabase, BotFather,
  Render, and cron-job.org setup.
- **Acceptance:** CI runs format, lint, typecheck, unit and integration tests, and the build. Render
  deploys `main` only after checks pass (`autoDeployTrigger: checksPass`) and runs migrations before
  the server starts. A branch protection rule that requires the `check` status is a manual GitHub
  setting, described in the README.

---

## Phase 1: Commerce core (no AI)

Exit criteria: a customer buys a fixed-price product with pickup through buttons only, and an
unpaid order expires and releases its stock.

### 1.0 Mini App sign-in

- **Doc:** Sign-in.
- **Deliverables:** `POST /auth/mini-app`, which verifies Telegram `initData` (HMAC-SHA-256 with a
  key derived from the bot token and `WebAppData`), rejects data older than 24 hours, and returns a
  signed bearer token; `requireAuth` middleware that sets the caller's Telegram user ID;
  `requireShopOwner` middleware for `/shops/:shopId/...` routes. The Telegram Login Widget for the
  browser dashboard stays in Task 8.1.
- **Acceptance:** tampered, stale, or unsigned `initData` returns 401. A valid token for a user who
  does not own the shop returns 403.
- **Built as:** `modules/auth/` with `AUTH_TOKEN_SECRET`, 12-hour HS256 tokens from `jose`, and
  `http/caller.ts` (`req.caller`, `callerOf`). Rotating the secret signs everyone out.

### 1.1 Shops and onboarding API

- **Doc:** Shop onboarding.
- **Deliverables:** create a shop with the caller as owner; read the owner's shops; save the shop's
  location and payment accounts; connect the channel and verify with `getChatMember` that the bot
  is an admin that can post. Delivery settings belong to Task 5.2, and drivers to Task 5.3.
- **Acceptance:** onboarding fails with a clear error when the bot is not a channel admin with post
  permission.

### 1.2 Catalog and channel posts

- **Doc:** Order intake and price negotiation (step 1 and 2).
- **Deliverables:** products and variants with pricing modes (fixed, or negotiable with asking and
  lowest price); **Post to channel** with a **Buy** or **Ask price** deep-link button; tap counting
  on `channel_posts`; the demo seed for "Selam Shoes".
- **Acceptance:** a negotiable product's post contains no price. The lowest price never appears in
  any API response except the owner's product editor.

### 1.3 Order state machine

- **Doc:** Key workflows (state machine).
- **Deliverables:** `orders.domain.ts` with the transition table as data and a pure
  `nextState(order, event)` function; `OrderService.transition()` that applies a transition, changes
  reservations in the same transaction, writes `order_events`, and publishes a domain event after
  commit.
- **Acceptance:** unit tests cover every allowed and every forbidden transition. An integration test
  shows that two parallel orders for the last unit reserve it once.

### 1.4 Button-only purchase flow

- **Doc:** Order intake steps 2, 3, 5, and 6. Design principles (buying works without the model).
- **Deliverables:** deep-link handler, product card, size buttons, **Share contact**, pickup-only
  delivery (Phase 5 adds the other options), and payment instructions from a template.
- **Acceptance:** the whole flow works with Gemini disabled.

### 1.5 Payment deadlines

- **Doc:** Scheduled jobs (tick).
- **Deliverables:** timers for the reminder one hour after the order and for expiry at the deadline;
  expiry releases stock and offers a one-tap reorder.
- **Acceptance:** an expired order's stock is available again, and the reorder button recreates the
  cart.

### 1.6 Owner alerts and takeover

- **Doc:** Owner review and takeover.
- **Deliverables:** owner notification service; conversation mode (agent or human); **Take over**
  and **Hand back**; automatic hand-back after two hours of owner silence.
- **Acceptance:** while a chat is in human mode, Buchi sends nothing to that customer.
- **Built as:** `modules/owner/` with `conversations` (mode and hand-back deadline) and
  `relayed_messages` (owner message to customer). Owners reply by replying to a relayed message in
  Telegram; a reply counts as taking over and restarts the two hours. A new Buy link still works in
  human mode, so a customer is never stuck in one shop's chat.

---

## Phase 2: AI platform (Track A)

Exit criteria: a test agent with one tool runs end to end through the registry and the guard, its
trace is stored, and the evaluation runner replays a recorded conversation.

### 2.1 Gemini client and quota manager

- **Doc:** Gemini usage and evaluation.
- **Deliverables:** `ai/gemini.ts` behind an interface (text, structured JSON output, vision,
  embeddings, function calling); model routing by task type; `ai/quota.ts` with a sliding one-minute
  window, a daily budget that resets at midnight Pacific time (as Gemini's does), and priorities; retries with backoff; a fake client for tests.
- **Acceptance:** when the budget is spent, low-priority calls fail fast with `QUOTA_EXHAUSTED`
  while payment checks still run.

### 2.2 Tool registry and actor scoping

- **Doc:** Agent tools, Design principles (tools depend on the actor).
- **Deliverables:** a registry where each tool declares its name, `zod` input schema, allowed actor,
  autonomy level, and handler. An agent receives only the tools for its actor.
- **Acceptance:** a customer agent cannot list or call an owner tool, even when the model output
  names one.

### 2.3 Policy guard

- **Doc:** Autonomy levels, Bounded decisions.
- **Deliverables:** `ai/guard/` with one checker per bounded decision (negotiated price, delivery
  price, deadline extension); owner-confirmation requests for the "Owner confirms" level; code-
  computed counteroffers on rejection; escalation after two rejections; `agent_decisions` records.
- **Acceptance:** unit tests show that no input returns an accepted price outside the limits.
  Checkers never return the lowest price to the caller.
- **Built as:** `ai/guard/`. A counteroffer below the lowest price is the lowest price plus a quarter
  of the gap, rounded up to the next 50 birr and capped at the asking price; a price counts as a
  concession only when it is below the agent's standing offer. "Owner confirms" requests are
  `agent_decisions` rows with `owner_status = pending`. Phases 6 and 7 run an approved request's
  stored input through the tool's handler.

### 2.4 Agent runtime and traces

- **Deliverables:** one agent loop (prompt, tool calls, tool results, reply) shared by all three
  agents; versioned prompts in `ai/prompts/`; `agent_traces` records with tokens and latency.
- **Acceptance:** a tool error returns to the model as a tool result, not as a crash. Every model
  call has a trace.
- **Built as:** `AgentRuntime.run` returns `reply` or `escalated` (two guard rejections, the
  six-step limit, or an empty reply). `GenerateResult.content` carries Gemini's thought signatures
  back on the next function-calling request.

### 2.5 Evaluation harness

- **Doc:** Gemini usage and evaluation.
- **Deliverables:** dataset format, a runner that replays recorded model responses in CI and calls
  Gemini in the nightly workflow, metric reports, and a nightly GitHub Actions workflow.
- **Acceptance:** CI runs the suite in replay mode with no network access.
- **Built as:** the `@buchi/evals` workspace package, which imports server code through
  `@buchi/server`'s `exports`. Recordings are keyed by a hash of tier, system prompt, contents,
  tools, and schema. Scores are compared with `evals/baseline.json`, updated at release with
  `pnpm evals:record --update-baseline`. The nightly run skips when the `GEMINI_API_KEY` repository
  secret is missing; model IDs are repository variables.

---

## Phase 3: Payments and fraud (Track B, needs 2.1)

Exit criteria: a real Telebirr screenshot is approved automatically, and a reused one is rejected,
including across two shops.

### 3.1 Receipt extraction

- **Doc:** Payment verification, layer 1.
- **Deliverables:** image classification (receipt, product, other) and structured extraction with a
  `zod` schema and per-field confidence.
- **Acceptance:** malformed model output leads to owner review, never to approval.

### 3.2 Rules R1 to R6

- **Deliverables:** `payments.domain.ts` with each rule as a pure function; `payment_refs` claim
  that relies on the unique index for R6.
- **Acceptance:** one unit test for each rule outcome; an integration test where two shops claim the
  same reference in parallel and exactly one wins.

### 3.3 Bank receipt checks

- **Deliverables:** Telebirr and CBE receipt clients in `integrations/receipts/` that return
  `CONFIRMED`, `NOT_FOUND`, `MISMATCH`, or `UNAVAILABLE`, with timeouts.
- **Acceptance:** parser tests use saved pages as fixtures. A timeout returns `UNAVAILABLE`.

### 3.4 Decision matrix and risk signals

- **Deliverables:** pure decision function over rule results, bank result, amount, and payer risk;
  `risk_signals` with HMAC-hashed payer keys; owner review messages with **Approve** and **Reject**.
- **Acceptance:** every row of the design doc's decision table is a test case.
- **Built as:** `modules/payments/`. R1 checks readability: classification and every key field need
  confidence of at least 0.7. An R6 claim is released when the payment is rejected, so a fraudulent
  first submission cannot block the rightful order. A bank-confirmed underpayment keeps its claim
  and counts toward the next receipt. CBE Birr receipts and the newer CBE `mbreciept` receipts are
  not bank-checked, because their pages need the payer's phone or an app token.

---

## Phase 4: Sales agent (Track A, needs 2 and 1)

Exit criteria: a customer negotiates a negotiable product in Amharic, sends a product photo,
and completes an order, while the guard holds every limit.

### 4.1 Conversation and catalog tools

- **Deliverables:** sales agent prompt; tools `search_products`, `get_my_orders`, `update_cart`,
  `confirm_order`, `request_human`; automatic handoff when the customer asks for a human.
- **Acceptance:** the agent never states a price that did not come from a tool result.

### 4.2 Price negotiation

- **Doc:** Order intake and price negotiation.
- **Deliverables:** `offer_price` tool for negotiable products only; evidence the agent receives
  (cart size, purchase history, stock, demand today, days in stock), never the lowest price; agreed
  price stored on the cart.
- **Acceptance:** evaluation sets show zero prices outside the range and zero discounts on fixed-price
  products, including adversarial messages.
- **Built as:** `ai/agents/sales/` with ten tools, `modules/sales/` (agreed prices in `negotiations`,
  re-checked inside the order transaction), `modules/demand/` (demand signals and waitlist), and
  photo search in `modules/catalog/`. History is the last 12 text turns in
  `conversations.recent_turns`, without tool results, so stale prices never return. Every price in
  a reply must come from a tool result or the code-built context, or the reply is replaced. Product
  embeddings are computed by a `product.embed` timer saved with the product; the match cutoff
  (cosine distance 0.3) is tuned in Task 10.1. "Forget my details" is recognized in code.

### 4.3 Product search from a photo

- **Deliverables:** product description embeddings when a product is saved; `find_similar` with
  `pgvector`; `demand_signals` when nothing matches.
- **Acceptance:** the evaluation set reaches the target for the right product in the top three.

### 4.4 Customer memory and waitlist

- **Deliverables:** `remember_fact`, the "forget my details" path, and `join_waitlist`.
- **Acceptance:** after "forget my details", no facts remain for that customer.

---

## Phase 5: Delivery (Track C)

Exit criteria: Express, Saver, and far-area deliveries run end to end with drivers in Telegram.

### 5.1 Location input

- **Doc:** Delivery location.
- **Deliverables:** parsers for a Telegram location and a Google Maps link (pure functions with
  fixtures); Nominatim client with a one-request-per-second limiter and a cache; landmark memory.
  Landmark extraction from text joins in Task 4.1 as the `set_location` tool, which also wires
  `LandmarkService` and the Nominatim client into `index.ts`.
- **Acceptance:** a Maps link without coordinates returns a clear "ask for a pin" result.

### 5.2 Delivery options and fees

- **Doc:** Delivery options.
- **Deliverables:** OpenRouteService client with a 24-hour cache by destination zone; pure fee
  functions for the free, standard, far, and pickup options; the straight-line fallback.
- **Acceptance:** unit tests cover every range boundary and the rounding rule.
- **Built as:** `modules/delivery/` with the `PUT /shops/:shopId/delivery-settings` owner route and
  the delivery choice in checkout. Routes go to the destination's H3 resolution-9 cell centre, so the
  cache is shared and exact pins never leave Buchi. The ORS path is
  `/openrouteservice/v2/directions/driving-car` with the raw key in `Authorization`. Saver is Express
  minus the discount, rounded so the customer always gets at least the promised discount.

### 5.3 Drivers and dispatch

- **Doc:** Shop onboarding (drivers), Dispatch and tracking.
- **Deliverables:** invite links; availability; `delivery_jobs` and `job_offers`; first-accept-wins
  with the conditional update; **Picked up** and **Delivered** with the 300 m location check; job
  alerts in the chat.
- **Acceptance:** an integration test with ten parallel accepts produces one winner.
- **Built as:** `modules/drivers/` (invites, availability, dispatch, offers, trips, owner bonus, Saver
  runs). Invite tokens are stored hashed and work once. Dispatch subscribes to the order's `paid`
  transition and recomputes the payout with the delivery formula. Only the distance to the pin is
  stored at delivery, never the driver's coordinates. Phase 6 replaces the code-computed bonus.

### 5.4 Saver runs

- **Deliverables:** pure sweep grouping, nearest-neighbor ordering, and 2-opt improvement; the
  Saver run job that uses the OpenRouteService Matrix API.
- **Acceptance:** unit tests show 2-opt never makes a route longer, and groups respect the six-stop
  limit.
- **Built as:** each shop has its own chain of Saver-run timers at the owner's run times;
  `/jobs/saver-run` runs every waiting shop now. Jobs record route and separate-trip payouts and
  job-level estimated and actual minutes; Task 5.5 may need them per stop.

### 5.5 Learned delivery factors

- **Doc:** Learned delivery factors.
- **Deliverables:** pure factor computation (clipping, recency weights, shrinkage to the parent
  zone); the nightly learning job; the synthetic trip seeder; the backtest runner.
- **Acceptance:** a zone with no trips returns its parent's factor. The backtest reports error for
  the statistics alone and for the AI estimate.
- **Built as:** trip legs are learned per stop from `job_stops` timing; `POST /jobs/nightly-learning`
  (cron, 02:00) learns factors and deletes pins older than seven days from orders, pending customer
  pins, and processed `telegram_updates`. Evals suites `far-price-statistics` and `far-price-agent`.

### 5.6 Far-area quotes (needs 2.3)

- **Doc:** Far-area delivery prices.
- **Deliverables:** `Quoting` flow with a 20-minute hold; evidence builder (similar trips, factors,
  area notes); `propose_delivery_price` through the guard; **Approve once** and **Offer pickup**
  for prices above the cap; the 10% raise timer; the statistical fallback when Gemini is unavailable.
- **Acceptance:** no offer to a driver ever exceeds the cap without an owner approval record.
- **Built as:** `modules/far-quotes/` and `ai/agents/far-price/` (smart tier, operations priority,
  one tool bound to the quote). Statistical prices also pass the policy guard. Far jobs are
  `delivery_jobs.special`: a driver *holds* them with `job:hold`, and normal accept and bonuses
  refuse them. Drivers hold far offers in the chat or on the driver board.

---

## Phase 6: Operations agent (Track A, needs 4 and 5.3)

Exit criteria: every situation in the design doc's problem-handling table produces the expected
action in the evaluation set.

### 6.1 Triggers and situation summaries

- **Deliverables:** subscriptions to domain events (customer reply near the deadline, driver
  problem, late delivery, no driver accepted, waitlist threshold, **Problem** button); a situation
  builder that collects the order, timeline, messages, and limits.
- **Acceptance:** the agent runs only on these events, never on a schedule.

### 6.2 Operations tools

- **Deliverables:** `message_customer`, `message_driver`, `update_eta`, `reschedule_delivery`,
  `extend_deadline`, `start_exchange`, `propose_refund`, `propose_restock`, `escalate`, with the
  autonomy levels from the design doc. Driver reports become `area_notes`.
- **Acceptance:** a second deadline extension on the same order goes to the owner.
- **Built as:** `ai/agents/operations/`, `ai/approvals/`, and `modules/operations/`. A run is scoped
  to its situation's record IDs, so a message cannot point the agent at another order. Owner-confirms
  requests reach owners as Approve and Decline buttons; approval claims the row before running, so
  it runs once. Extra tools: `propose_bonus` (owner confirms; replaces the code-computed bonus) and
  `save_area_note` (automatic). New transition `rescheduled` (`out_for_delivery → paid`).
- **Follow-ups:** finish exchanges (sell the new unit, return the old one to stock), and merge
  `DeliveryOwnerAlerts` into `OwnerAlerts`.

---

## Phase 7: Owner assistant and listings (Track A, needs 2)

### 7.1 Commands to rules

- **Deliverables:** `propose_rule` for promotions, delivery pauses, and setting changes; an
  Ethiopian-time helper (pure function); previews with **Confirm**; `owner_rules` applied by the
  services that they affect.
- **Acceptance:** "ከ10 ሰዓት በኋላ" (after 10 o'clock) resolves to 4:00 PM in tests.

### 7.2 Questions about the business

- **Deliverables:** read-only reporting views; `ask_data` with SQL parsing and an allowlist, a row
  limit, a three-second timeout, and a read-only role; QuickChart client.
- **Acceptance:** tests show that `UPDATE`, multiple statements, and tables outside the allowlist are
  rejected before they reach the database.

### 7.3 Weekly suggestions

- **Deliverables:** fixed analysis queries and a prompt that returns up to three suggestions, each
  linked to a rule preview.
- **Acceptance:** every number in a suggestion comes from a query result in the trace.

### 7.4 Snap-to-list and restock waitlist

- **Deliverables:** `draft_listing` from photos; **Post**, **Edit**, and **Discard**; negotiable
  products ask for asking and lowest prices privately; waitlist notifications with 30-minute holds,
  read from the `waitlist` table and `demand_signals.notify_requested`.
- **Acceptance:** a listing never gets a price that the owner did not write.
- **Built as (Phase 7):** `ai/agents/owner-assistant/`, `modules/rules/` (Ethiopian-time helper;
  pauses, promotions on fixed prices only, settings changes, confirmed through `ai/approvals`),
  `modules/reporting/` (SQL guard with `node-sql-parser`; seven `report_*` views read by the
  `report_reader` role in a read-only, three-second transaction with shop row-level security),
  `modules/listings/` (the draft schema has no price field), and restock holds through
  `OrderService` (`stock_holds`, 30-minute timer). Weekly suggestions drop any suggestion with a
  number that the analysis did not return.
- **Follow-ups:** show promoted prices on product cards and in `search_products`; let owners end a
  rule early; store the drafted category; skip shops with no recent orders in the weekly job.

---

## Phase 8: Frontend (Track D)

Start each screen when its module's API schemas exist in `@buchi/shared`. Every screen handles
loading, empty, and error states.

### 8.1 App shell and authentication

- **Deliverables:** role entry points; Telegram Mini App SDK integration (theme, back button, main
  button); the `initData` exchange from Task 1.0; Telegram Login Widget for the browser; API client with
  TanStack Query; SSE client.
- **Acceptance:** opening the owner Mini App as a customer shows "not allowed" and no data.

### 8.2 Customer Mini App

- **Deliverables:** map picker with the suggested pin, delivery options with fees, and order
  tracking.

### 8.3 Driver Mini App

- **Deliverables:** open jobs, special offers, route map, job actions with location access, trip
  history, and payouts owed.

### 8.4 Owner Mini App and browser dashboard

- **Deliverables:** the screens in the design doc's user interface table, built in this order:
  Onboarding, Orders, Payment review, Inventory, Deliveries, Drivers, Conversations, AI decisions,
  Zones, Insights, Settings.
- **Acceptance:** each role's bundle loads only its own code, and the map loads only on map screens.
- **Built as:** the web app is served under `/app/<role>/` (owner, driver, customer) from the same
  origin; live order updates stream from `GET /shops/:shopId/events`. The map picker returns the pin
  with `Telegram.WebApp.sendData`, which arrives as `web_app_data` through the existing webhook. The
  official `telegram-web-app.js` script provides the SDK. `WEB_APP_URL` (HTTPS) enables the Mini App
  buttons, and the server build bundles `@buchi/shared`.
- **Remaining owner screens:** built in Task 9.3.

---

## Phase 9: Jobs and reports

### 9.1 Daily jobs

- **Deliverables:** evening summary, morning brief, weekly suggestions trigger, and nightly
  learning with coordinate retention, all registered as job endpoints with **Run now** support.

### 9.3 Remaining owner screens

- **Deliverables:** read endpoints and screens for payment review, conversations with **Take over**
  and **Hand back**, AI decisions, the deliveries map, zones, and insights; **Run now** buttons.
- **Built as:** screenshots stream from Telegram through an owner-only proxy and are never stored.
  Dashboard decisions call the same services as the chat buttons. Run now runs one shop's daily
  report without the job secret. First reply time is measured from `reply_times` (Task 10.2). A far-area price above the cap is still answered in the chat.

### 9.2 Google Sheets ledger

- **Deliverables:** Sheets client; ledger rows on payment approval; retry queue in Postgres.
- **Acceptance:** when Sheets is down, rows wait in the queue and arrive later without duplicates.
- **Built as:** `ledger_rows` keyed per shop; each attempt reads the tab's first column and appends
  only missing keys, so a lost response never duplicates a row. The tick sends due rows with
  exponential backoff. Without Google credentials the server starts and rows wait. Daily jobs
  `morning-brief` and `evening-summary` send once per shop and Addis day (`daily_report_runs`).

---

## Phase 10: Evaluation, hardening, and demo

### 10.1 Evaluation datasets

- **Deliverables:** the eight datasets from the design doc's evaluation table, with recordings for
  replay mode, and target thresholds in CI. The live nightly run samples cases, because about 400
  cases at 10 requests a minute exceed the free tier's daily quota.

### 10.2 Hardening

- **Deliverables:** reclaiming timers stuck in `running` after a crash, with retries based on
  `attempts`; a pass over every fallback in the design doc's third-party table and risk table,
  each with a test; rate limits on public endpoints; a load check of the tick with 1,000 due timers.

- **Built as:** a timer still `running` after a 10-minute lease returns to `pending`, and fails after
  three claims; a late result from an expired claim changes nothing. Per-IP and per-user rate limits
  answer `RATE_LIMITED` (429); `TRUST_PROXY_HOPS` must be confirmed from `req.ips` after the first
  Render deploy. Security headers: a strict default CSP, and per-role Mini App policies that allow
  Telegram Web to embed the pages (`'unsafe-eval'` only on the owner page, for the Login Widget).
  `reply_times` stores only arrival and reply times. A far-area price on a straight-line route always
  goes to the owner. Map screens keep their lists when the map cannot load.
- **Follow-ups:** local long-polling mode; a GitHub Actions fallback for the daily jobs; owner
  correction of trip times; an eval gate that requires the far-price agent to beat the statistics;
  a check that each role's bundle stays separate.

### 10.3 Demo

- **Deliverables:** demo seed data (shop, products, drivers, synthetic trips); a demo script that
  covers negotiation, a rejected reused receipt, a far-area quote, a driver problem, and an owner
  command; the README; the video.

---

## Definition of done

A task is done when all of the following are true:

- [ ] The behavior matches the design doc sections listed on the task card.
- [ ] The acceptance criteria pass as automated tests.
- [ ] `pnpm lint`, `pnpm typecheck`, and all tests pass in CI.
- [ ] The code follows [Engineering rules](#engineering-rules), with no dead code and no unused
      exports.
- [ ] New environment variables are in `.env.example` and in `config/env.ts`.
- [ ] Schema changes come with a migration, and shop-owned tables have a row-level security policy
      and a test.
- [ ] The pull request description lists what changed, why, and any new dependency with its reason.
