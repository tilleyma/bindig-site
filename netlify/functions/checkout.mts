// Creates a Stripe Checkout session for the one-off unlock.
import { json, env } from "../../lib/http.mts";
import { record } from "../../lib/track.mts";

export default async (req, context) => {
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  const key = env("STRIPE_SECRET_KEY");
  let email = "";
  try { const b = await req.json(); email = typeof b?.email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(b.email) ? b.email.trim().slice(0, 200) : ""; } catch {}
  await record("checkout", { enabled: !!key, gaveEmail: !!email }, req, context);
  if (!key) return json({ error: "Payments aren't switched on yet. Join the waitlist and we'll email you." }, 503);
  const origin = new URL(req.url).origin;
  const price = Number(env("PRICE_CENTS") || 900);
  const form = new URLSearchParams({
    mode: "payment",
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": String(price),
    "line_items[0][price_data][tax_behavior]": "inclusive",
    "line_items[0][price_data][product_data][name]": "BINDIG full library fix",
    "line_items[0][price_data][product_data][description]": "Every tag fix, the Purge playlists by genre and a fixed Rekordbox XML.",
    success_url: `${origin}/scan/?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/scan/?cancelled=1`,
    allow_promotion_codes: "true",
    "metadata[product]": "bindig-fix-v1",
  });
  if (email) form.set("customer_email", email);
  // Tax: price is always $9 all-in. Managed Payments (Stripe as merchant of record) is switched on with STRIPE_MANAGED_PAYMENTS=true
  // once its terms are accepted in the Stripe Dashboard; otherwise STRIPE_AUTOMATIC_TAX=true uses Stripe Tax.
  const managed = env("STRIPE_MANAGED_PAYMENTS") === "true";
  if (managed) form.set("managed_payments[enabled]", "true");
  else if (env("STRIPE_AUTOMATIC_TAX") === "true") form.set("automatic_tax[enabled]", "true");
  const r = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/x-www-form-urlencoded", ...(managed ? { "stripe-version": "2026-02-25.preview" } : {}) },
    body: form,
  });
  const s = await r.json();
  if (!r.ok) { console.error("stripe checkout error", s?.error?.message); return json({ error: "Checkout couldn't start. Try again in a minute." }, 502); }
  return json({ url: s.url });
};

export const config = { path: "/api/checkout" };
