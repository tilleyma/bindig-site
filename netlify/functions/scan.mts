// Free scan: health score, counts and a small preview. No payment needed.
import { analyse, preview } from "../../lib/engine.mts";
import { json, readTracks } from "../../lib/http.mts";
import { record, scanSummary } from "../../lib/track.mts";

export default async (req, context) => {
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  const { tracks, error } = await readTracks(req);
  if (error) return json({ error }, 400);
  const r = analyse(tracks);
  await record("scan", scanSummary(r, tracks), req, context);
  return json(preview(r));
};

export const config = { path: "/api/scan" };
