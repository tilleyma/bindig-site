// Beta sharing. POST (opt-in users): saves the choices made at download ("after").
// GET ?key=STATS_KEY (owner): lists shared libraries; &get=<key> returns one; POST ?key=..&clear=all deletes all.
import { json, env } from "../../lib/http.mts";
import { saveShare, listShares, getShare, clearShares, optedIn } from "../../lib/share.mts";

export default async (req, context) => {
  const u = new URL(req.url);
  const owner = env("STATS_KEY") && u.searchParams.get("key") === env("STATS_KEY");
  if (owner && req.method === "POST" && u.searchParams.get("clear") === "all") return json({ deleted: await clearShares() });
  if (owner && req.method === "GET") {
    const k = u.searchParams.get("get");
    if (k) { const d = await getShare(k); return d ? json(d) : json({ error: "Not found." }, 404); }
    return json({ shares: await listShares() });
  }
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  if (!optedIn(req)) return json({ saved: false });
  let body; try { body = await req.json(); } catch { return json({ error: "Bad data." }, 400); }
  const pick = (a, n) => (Array.isArray(a) ? a.slice(0, n) : []);
  const key = await saveShare("after", {
    tracks: Number(body?.tracks) || 0,
    fixes: pick(body?.fixes, 50000), gems: pick(body?.gems, 50000), mixes: pick(body?.mixes, 50), tidy: pick(body?.tidy, 50000),
  }, req, context);
  return json({ saved: !!key });
};

export const config = { path: "/api/share" };
