# BINDIG landing page

Static waitlist page. Deployed on Netlify; sign-ups are collected by Netlify Forms (form name: `waitlist`).

## Sandbox (test before release)
- Every change for v0.3+ is built on a branch and opened as a pull request.
- Netlify builds a **Deploy Preview** for each pull request at `https://deploy-preview-<N>--bindig.netlify.app`.
- Previews show an amber **Sandbox** ribbon, use **Stripe test mode** (card 4242 4242 4242 4242) and keep their own stats, feedback and beta data, separate from production.
- Martin tests the preview and says "release"; the pull request is merged and Netlify deploys to production.

## v0.5 beta: /dig/ (sandbox first)
- `/dig/` — drop a rekordbox XML → DJ profile card + bio → free crate in the DJ's lead lane → extra crates at $1.99 (Stripe, `item: "crate"`).
- AI: `netlify/functions/ai.mts` (`/api/ai/profile`, `/api/ai/crate`) calls Claude through the Netlify AI Gateway, streamed. Models: `BINDIG_MODEL_PROFILE` (default claude-sonnet-5-5), `BINDIG_MODEL_CRATE` (default claude-opus-5-5). Prompts in `lib/dig-ai.mts`.
- Crate passes: signed with `UNLOCK_SECRET`, single use (Blobs store `crate-tickets`). Friend codes (`FRIEND_CODES`, `CODE:uses`) via `/api/redeem` give a 30-day pass: any lane free, up to `FRIEND_CRATES` crates (default 10), plus Clean my tags. Free pass comes back with the profile; paid pass from `/api/verify` after checkout. Price: `CRATE_PRICE_CENTS` (default 199).
- Picks are checked against Apple Music / Deezer in the browser (same JSONP lookup as /scan/ previews); found tracks rank first, the rest are marked "not found online".
