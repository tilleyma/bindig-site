// Paid run: every fix and the full purge list. Needs a valid unlock token.
import { analyse } from "../../lib/engine.mts";
import { json, readTracks, verifyToken, env } from "../../lib/http.mts";

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const licence = verifyToken(token, env("UNLOCK_SECRET"));
  if (!licence) return json({ error: "This library isn't unlocked yet." }, 402);
  const { tracks, error } = await readTracks(req);
  if (error) return json({ error }, 400);
  const r = analyse(tracks);
  return json({ health: r.health, taste: r.taste, fixes: r.fixes, purge: r.purge });
};

export const config = { path: "/api/fix" };
