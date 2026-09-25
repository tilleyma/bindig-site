// Anonymous usage events for BINDIG. Stores totals only: never artist names, titles or file paths.
import { getStore } from "@netlify/blobs";

export async function record(kind, data, req, context) {
  try {
    const store = getStore({ name: "events", consistency: "strong" });
    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    const visitor = (req?.headers?.get("x-bindig-visitor") || "").replace(/[^a-z0-9-]/gi, "").slice(0, 40) || null;
    const country = context?.geo?.country?.code || null;
    const key = `${kind}/${day}/${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`;
    await store.setJSON(key, { kind, at: now.toISOString(), day, visitor, country, ...data });
  } catch (e) {
    console.error("track failed", kind, e?.message);
  }
}

// Totals from an analysis result that are safe to keep (counts only).
export function scanSummary(r, tracks) {
  const genres = {};
  for (const t of tracks) { const g = (t.genre || "(none)").slice(0, 40); genres[g] = (genres[g] || 0) + 1; }
  const topGenres = Object.fromEntries(Object.entries(genres).sort((a, b) => b[1] - a[1]).slice(0, 25));
  const h = r.health;
  return {
    tracks: h.tracks, played: h.played, score: h.score, fixes: h.fixes, fixable: h.fixable,
    byRule: h.byRule, genreNeedsLookup: h.genreNeedsLookup, yearMissing: h.yearMissing, labelMissing: h.labelMissing,
    duplicates: h.duplicates, purgeCandidates: h.purgeCandidates, bpmRange: r.taste.bpmRange, genres: topGenres,
  };
}
