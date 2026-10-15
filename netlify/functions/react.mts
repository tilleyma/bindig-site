// v0.6: anonymous reactions on crate records (bag: play next / not me; shelf: want / have / not me).
// Counts only, never artist or title, so we can measure the hit rate per crate and lane.
import { json } from "../../lib/http.mts";
import { record } from "../../lib/track.mts";

const SIDES = new Set(["bag", "shelf"]);
const REACTS = new Set(["play", "want", "have", "no", "clear"]);

export default async (req: Request, context: any) => {
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  let b: any; try { b = await req.json(); } catch { return json({ error: "Couldn't read that." }, 400); }
  const side = String(b?.side || ""), r = String(b?.r || "");
  if (!SIDES.has(side) || !REACTS.has(r)) return json({ error: "Unknown reaction." }, 400);
  const lane = String(b?.lane || "").replace(/[^\w &/'.-]/g, "").slice(0, 60);
  const pos = Math.max(0, Math.min(30, Number(b?.pos) || 0));
  context.waitUntil?.(record("react", { side, r, lane, pos }, req, context));
  return json({ ok: true });
};

export const config = { path: "/api/react", method: "POST", rateLimit: { windowLimit: 60, windowSize: 60, aggregateBy: ["ip", "domain"] } };
