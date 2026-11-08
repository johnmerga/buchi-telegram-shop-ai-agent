# Demo

How to fill a shop with demo history, start the live scenarios, and remove it all again. The
scripts run on your machine against the database in `DATABASE_URL`, so point that at the database
you want to change. Every command takes the shop's ID.

## Who plays whom

| Account | Role |
|---|---|
| 1 | Owner of the established shop (Selam-v2, `t.me/selamShoesV2`) |
| 2 | Customer |
| 3 | Second customer |
| 4 | Driver, linked to the shop |
| 5 | A new owner, to show onboarding from scratch. It needs no demo data. |

## Demo history

```sh
pnpm --filter @buchi/server demo:seed <shop-id>
pnpm --filter @buchi/server demo:photos <shop-id>
```

`demo:seed` first removes the shop's earlier demo data, so running it again gives the same shop.
It adds, relative to now:

- the demo delivery prices (30 birr base, 12 per km, 1.50 per minute, standard range 18 km, far cap 400), which it prints;
- 17 products from the photo list `evals/inbox/photos/demo-photos.json`: football boots by item
  code and kids' shoes by brand, with asking and lowest prices;
- 40 demo customers and 120 orders over six weeks, busier at weekends, with three best-sellers
  and one product that barely sells;
- their payments: CBE ones approved with the bank's page, Telebirr ones approved by the owner, a
  few rejected, and one reported that waits in **Payment review**;
- their deliveries across Addis neighbourhoods, by four demo drivers and the shop's real ones;
- 120 far trips with raises, two driver area notes, and a sold-out size with a waitlist;
- the learned time and acceptance factors from all of it.

`demo:photos` uploads each product's photo the way the dashboard does, which needs
`TELEGRAM_BOT_TOKEN` and the owner to have started the bot. The server's timer tick then
computes the photo-search embeddings.

Demo customers and drivers have made-up Telegram IDs (from 9,000,000,000,000 up), and the bot
never sends them anything. The photos and their list stay in the gitignored `evals/inbox/`.

## Live scenarios

Each scenario only sets up rows that the real flow would have made. The real timers, events, and
agents then take over. Run one trip scenario at a time, because a driver has one trip on the road.

```sh
pnpm --filter @buchi/server demo:scenario late-delivery <shop-id> --customer <2> --driver <4>
pnpm --filter @buchi/server demo:scenario customer-silent <shop-id> --customer <2> --driver <4>
pnpm --filter @buchi/server demo:scenario restock-waitlist <shop-id> --customer <3>
pnpm --filter @buchi/server demo:scenario far-over-cap <shop-id>
```

| Scenario | What it sets up | What happens next |
|---|---|---|
| `late-delivery` | A paid order on the road with the driver, past its estimate | Within a minute, the operations agent messages the customer and the driver |
| `customer-silent` | The same trip, on time | The driver writes "The customer is not answering", and the agent reschedules |
| `restock-waitlist` | The customer first in line for the sold-out size | The owner sets that size to 1 in the dashboard, and the customer gets a held unit |
| `far-over-cap` | Nothing; it prints a spot to share | The customer buys and shares the spot, and the owner gets **Approve once** |

Payment screenshots for a live order come from the evals package, timed now:

```sh
pnpm --filter @buchi/evals demo:receipts --total <order total> --name "<account holder>" --phone <Telebirr number>
```

From the customer account, within one order's 3-minute hold, send `underpaid.jpg` (Buchi asks for
the full amount) and then `edited-total.jpg` (it goes to the owner). For a second order, send
`reused.jpg`: it is rejected, with **Report a problem**.

Negotiation, photo search, and owner questions need no setup: chat with the bot.

## Remove the demo

```sh
pnpm --filter @buchi/server demo:reset <shop-id>
```

It removes the demo customers and everything they ordered, the demo drivers, far trips, area
notes, and the seeded road legs, then learns the factors again. A demo product that a real order
names stays, switched off, so that order keeps its item. The owner's own rows stay as they were.
