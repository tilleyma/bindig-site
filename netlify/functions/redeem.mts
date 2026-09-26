// Friend / beta codes: unlock for free without Stripe. Codes live in the FRIEND_CODES env var
// as "CODE" or "CODE:limit", comma-separated. Uses are counted in Netlify Blobs.
import { getStore } from "@netlify/blobs";
import { json, env, signToken } from "../../lib/http.mts";
import { record } from "../../lib/track.mts";

export default async (req, context) => {
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  let body = {}; try { body = await req.json(); } catch {}
  const code = String(body.code || "").trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 40);
  if (!code) return json({ error: "Enter your code." }, 400);
  const codes = Object.fromEntries(String(env("FRIEND_CODES") || "").split(",").map((c) => c.trim()).filter(Boolean)
    .map((c) => { const [k, n] = c.split(":"); return [k.toUpperCase(), Number(n) || 25]; }));
  const secret = env("UNLOCK_SECRET");
  if (!secret || !codes[code]) return json({ error: "That code isn't valid." }, 404);
  let used = 0;
  try {
    const store = getStore({ name: "codes", consistency: "strong" });
    used = Number(await store.get(code)) || 0;
    if (used >= codes[code]) return json({ error: "That code has been fully used." }, 410);
    await store.set(code, String(used + 1));
  } catch (e) { console.error("code count failed", e?.message); }
  await record("friend", { code, used: used + 1 }, req, context);
  const token = signToken({ sid: `friend-${code.toLowerCase()}-${Date.now()}`, exp: Date.now() + 30 * 24 * 3600 * 1000 }, secret);
  return json({ token, left: Math.max(0, codes[code] - used - 1) });
};

export const config = { path: "/api/redeem" };
