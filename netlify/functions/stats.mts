// Private usage totals for the owner dashboard (/stats/). Needs ?key= matching STATS_KEY.
import { getStore } from "@netlify/blobs";
import { json, env } from "../../lib/http.mts";

export default async (req) => {
  const key = new URL(req.url).searchParams.get("key") || "";
  const want = env("STATS_KEY");
  if (!want || key !== want) return json({ error: "Not authorised." }, 401);
  const store = getStore({ name: "events", consistency: "strong" });
  const kinds = ["scan", "checkout", "paid", "fix"];
  const events = {};
  for (const k of kinds) {
    events[k] = [];
    const { blobs } = await store.list({ prefix: `${k}/` });
    const rows = await Promise.all(blobs.map((b) => store.get(b.key, { type: "json" })));
    events[k] = rows.filter(Boolean);
  }
  const scans = events.scan;
  const sum = (a, f) => a.reduce((x, y) => x + (Number(f(y)) || 0), 0);
  const visitors = new Set(scans.map((s) => s.visitor).filter(Boolean));
  const genres = {}, rules = {}, countries = {}, days = {};
  for (const s of scans) {
    for (const [g, n] of Object.entries(s.genres || {})) genres[g] = (genres[g] || 0) + n;
    for (const [r, n] of Object.entries(s.byRule || {})) rules[r] = (rules[r] || 0) + n;
    if (s.country) countries[s.country] = (countries[s.country] || 0) + 1;
    days[s.day] = (days[s.day] || 0) + 1;
  }
  const top = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n);
  const sizes = scans.map((s) => s.tracks).sort((a, b) => a - b);
  return json({
    generatedAt: new Date().toISOString(),
    totals: {
      scans: scans.length, people: visitors.size, tracks: sum(scans, (s) => s.tracks), played: sum(scans, (s) => s.played),
      fixes: sum(scans, (s) => s.fixes), purge: sum(scans, (s) => s.purgeCandidates), duplicates: sum(scans, (s) => s.duplicates),
      avgScore: scans.length ? Math.round(sum(scans, (s) => s.score) / scans.length) : null,
      medianLibrary: sizes.length ? sizes[Math.floor(sizes.length / 2)] : null,
    },
    funnel: { scans: scans.length, checkouts: events.checkout.length, paid: events.paid.length, fixRuns: events.fix.filter((f) => !f.tester).length, testerRuns: events.fix.filter((f) => f.tester).length },
    revenueCents: sum(events.paid.filter((p) => p.live), (p) => p.amount),
    days: Object.entries(days).sort(), genres: top(genres, 15), rules: top(rules, 10), countries: top(countries, 10),
  });
};

export const config = { path: "/api/stats" };
