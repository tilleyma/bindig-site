// Creates a Stripe Checkout session for the one-off unlock.
import { json, env, stripeKey } from "../../lib/http.mts";
import { record } from "../../lib/track.mts";

export default async (req, context) => {
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  const key = stripeKey(req);
  let email = "", item = "unlock", crate = "";
  try {
    const b = await req.json();
    email = typeof b?.email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(b.email) ? b.email.trim().slice(0, 200) : "";
    if (b?.item === "crate") { item = "crate"; crate = String(b?.crate || "").replace(/[^\w &/'.-]/g, "").trim().slice(0, 60); }
  } catch {}
  if (item === "crate" && !crate) return json({ error: "Pick a crate first." }, 400);
  await record("checkout", { enabled: !!key, gaveEmail: !!email, item }, req, context);
  if (!key) return json({ error: "Payments aren't switched on yet. Try again soon." }, 503);
  const origin = new URL(req.url).origin;
  const price = item === "crate" ? Number(env("CRATE_PRICE_CENTS") || 199) : Number(env("PRICE_CENTS") || 900);
  const form = new URLSearchParams({
    mode: "payment",
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": String(price),
    "line_items[0][price_data][tax_behavior]": "inclusive",
    "line_items[0][price_data][product_data][name]": "BINDIG · full unlock",
    "line_items[0][price_data][product_data][description]": "Undiscovered Gems, Gem Crates and clean tags for your Rekordbox library, as one import file.",
    success_url: `${origin}/scan/?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/scan/?cancelled=1`,
    allow_promotion_codes: "true",
    "metadata[product]": "bindig-fix-v1",
  });
  if (item === "crate") {
    // v0.5: one extra crate (ten tracks the DJ doesn't own yet) for $1.99.
    form.set("line_items[0][price_data][product_data][name]", `BINDIG · ${crate} crate`);
    form.set("line_items[0][price_data][product_data][description]", `One ${crate} crate: ten tracks you don't own yet, picked from your collection.`);
    form.set("success_url", `${origin}/dig/?crate_session={CHECKOUT_SESSION_ID}`);
    form.set("cancel_url", `${origin}/dig/?cancelled=1`);
    form.set("metadata[product]", "bindig-crate-v1");
    form.set("metadata[crate]", crate);
  }
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
  if (!r.ok) { console.error("stripe checkout error", s?.error?.message); const why = String(s?.error?.code || s?.error?.message || "").replace(/\b(sk|rk|pk)_(live|test)_[A-Za-z0-9*]+/g, "$1_$2_…").slice(0, 160); await record("checkoutfail", { item, code: String(s?.error?.code || r.status).slice(0, 60) }, req, context); return json({ error: "Checkout couldn't start. Try again in a minute.", why }, 502); }
  return json({ url: s.url });
};

export const config = { path: "/api/checkout" };
