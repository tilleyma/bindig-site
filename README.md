# BINDIG

Landing page + free Rekordbox library scan with a $9 Stripe unlock. Hosted on Netlify.

| Path | What |
|---|---|
| `/` | Landing page, waitlist via Netlify Forms (`waitlist`) |
| `/scan/` | Web app: parse XML in the browser, free health scan, paid full fix + download |
| `lib/engine.mts` | Analysis engine (tag fixes, Purge taste model). Server-side only |
| `netlify/functions/scan.mts` | `POST /api/scan` free preview |
| `netlify/functions/checkout.mts` | `POST /api/checkout` Stripe Checkout session ($9) |
| `netlify/functions/verify.mts` | `GET /api/verify?session_id=` checks payment, returns signed licence |
| `netlify/functions/fix.mts` | `POST /api/fix` full results, needs licence |

## Environment variables (Netlify)

| Key | Value |
|---|---|
| `STRIPE_SECRET_KEY` | `sk_test_…` first, `sk_live_…` at launch |
| `UNLOCK_SECRET` | Random string used to sign licences (set) |
| `PRICE_CENTS` | Optional, default `900` |
| `STRIPE_AUTOMATIC_TAX` | Optional `true` once Stripe Tax is on |
