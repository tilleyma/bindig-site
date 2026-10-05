// Focus panel: build one Gem Crate for a chosen genre / BPM range / length / vibe. Needs a valid unlock token.
import { analyse } from "../../lib/engine.mts";
import { json, readTracks, verifyToken, env } from "../../lib/http.mts";
import { record } from "../../lib/track.mts";

export default async (req, context) => {
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!verifyToken(token, env("UNLOCK_SECRET"))) return json({ error: "This library isn't unlocked yet." }, 402);
  const { tracks, prefs, focus, error } = await readTracks(req);
  if (error) return json({ error }, 400);
  if (!focus) return json({ error: "Pick a focus first." }, 400);
  const r = analyse(tracks, { prefs, focus });
  await record("focus", { tracks: tracks.length, genres: focus.genres.length, minutes: focus.minutes, vibe: focus.vibe, ok: r.focus.mixes.length > 0 }, req, context);
  return json({ mixes: r.focus.mixes, note: r.focus.note });
};

export const config = { path: "/api/crate" };
