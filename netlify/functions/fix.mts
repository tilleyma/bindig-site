// Paid run: every fix and the full purge list. Needs a valid unlock token.
import { analyse } from "../../lib/engine.mts";
import { json, readTracks, verifyToken, env } from "../../lib/http.mts";
import { record } from "../../lib/track.mts";

export default async (req, context) => {
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const licence = verifyToken(token, env("UNLOCK_SECRET"));
  if (!licence) return json({ error: "This library isn't unlocked yet." }, 402);
  const { tracks, error } = await readTracks(req);
  if (error) return json({ error }, 400);
  const r = analyse(tracks);
  await record("fix", { tracks: r.health.tracks, fixes: r.health.fixes, gems: r.health.gems, tester: String(licence.sid || "").startsWith("tester") }, req, context);
  return json({ health: r.health, taste: r.taste, fixes: r.fixes, gems: r.gems, tidy: r.tidy, mixes: r.mixes, gaps: r.gaps });
};

export const config = { path: "/api/fix" };
