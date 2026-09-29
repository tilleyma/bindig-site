// Site feedback. POST: store one message (type idea/issue/praise, message, optional email, page context).
// GET ?key=STATS_KEY: owner list, newest first.
import { getStore } from "@netlify/blobs";
import { json, env } from "../../lib/http.mts";

const store = () => getStore({ name: "feedback", consistency: "strong" });

export default async (req, context) => {
  const u = new URL(req.url);
  if (req.method === "GET") {
    if (!env("STATS_KEY") || u.searchParams.get("key") !== env("STATS_KEY")) return json({ error: "Not authorised." }, 401);
    const s = store(); const { blobs } = await s.list();
    const items = (await Promise.all(blobs.map((b) => s.get(b.key, { type: "json" })))).filter(Boolean).sort((a, b) => (a.at < b.at ? 1 : -1));
    return json({ count: items.length, items });
  }
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  let b; try { b = await req.json(); } catch { return json({ error: "Couldn't read that." }, 400); }
  const type = ["idea", "issue", "praise"].includes(b?.type) ? b.type : "idea";
  const message = String(b?.message || "").trim().slice(0, 3000);
  if (message.length < 3) return json({ error: "Write a few words first." }, 400);
  const email = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(b?.email || "").trim()) ? String(b.email).trim().slice(0, 200) : "";
  const c = b?.context && typeof b.context === "object" ? b.context : {};
  const ctx = { page: String(c.page || "").slice(0, 80), step: String(c.step || "").slice(0, 40), tab: String(c.tab || "").slice(0, 20), tracks: Number(c.tracks) || null };
  const now = new Date();
  const item = { type, message, email, ...ctx, at: now.toISOString(), country: context?.geo?.country?.code || null,
    visitor: (req.headers.get("x-bindig-visitor") || "").replace(/[^a-z0-9-]/gi, "").slice(0, 40) || null };
  try { await store().setJSON(`${now.toISOString().replace(/[:.]/g, "-")}-${Math.random().toString(36).slice(2, 7)}`, item); }
  catch (e) { console.error("feedback save failed", e?.message); return json({ error: "Couldn't send right now." }, 500); }
  return json({ ok: true });
};

export const config = { path: "/api/feedback" };
