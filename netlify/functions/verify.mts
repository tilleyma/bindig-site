// Confirms a Stripe Checkout session was paid and returns a signed unlock token.
import { json, env, signToken, stripeKey } from "../../lib/http.mts";
import { record } from "../../lib/track.mts";

export default async (req, context) => {
  const id = new URL(req.url).searchParams.get("session_id") || "";
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(id)) return json({ error: "That payment link isn't valid." }, 400);
  const key = stripeKey(req), secret = env("UNLOCK_SECRET");
  if (!key || !secret) return json({ error: "Payments aren't switched on yet." }, 503);
  const r = await fetch(`https://api.stripe.com/v1/checkout/sessions/${id}`, { headers: { authorization: `Bearer ${key}` } });
  const s = await r.json();
  if (!r.ok) return json({ error: "We couldn't find that payment." }, 404);
  if (s.payment_status !== "paid") return json({ error: "That payment hasn't completed." }, 402);
  await record("paid", { amount: s.amount_total || null, currency: s.currency || null, live: id.startsWith("cs_live_"), item: s.metadata?.product === "bindig-crate-v1" ? "crate" : "unlock" }, req, context);
  if (s.metadata?.product === "bindig-crate-v1") {
    // One paid crate. The session id is the ticket id, so the pass works once however often this is called.
    const ticket = signToken({ kind: "crate-paid", crate: s.metadata.crate || "", jti: id, exp: Date.now() + 7 * 24 * 3600 * 1000 }, secret);
    return json({ ticket, crate: s.metadata.crate || "" });
  }
  const token = signToken({ sid: id, email: s.customer_details?.email || null, exp: Date.now() + 30 * 24 * 3600 * 1000 }, secret);
  return json({ token, email: s.customer_details?.email || null });
};

export const config = { path: "/api/verify" };
