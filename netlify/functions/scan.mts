// Free scan: health score, counts and a small preview. No payment needed.
import { analyse, preview } from "../../lib/engine.mts";
import { json, readTracks } from "../../lib/http.mts";

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  const { tracks, error } = await readTracks(req);
  if (error) return json({ error }, 400);
  return json(preview(analyse(tracks)));
};

export const config = { path: "/api/scan" };
