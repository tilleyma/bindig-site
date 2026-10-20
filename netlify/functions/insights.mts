// Owner-only beta insights from opt-in shared libraries (before = scanned library, after = choices at download).
// GET ?key=STATS_KEY
import { getStore } from "@netlify/blobs";
import { json, env, storeName } from "../../lib/http.mts";
import { listShares, getShare } from "../../lib/share.mts";
import { analyse } from "../../lib/engine.mts";

export default async (req) => {
  const u = new URL(req.url);
  if (!env("STATS_KEY") || u.searchParams.get("key") !== env("STATS_KEY")) return json({ error: "Not authorised." }, 401);
  const keys = await listShares(req);
  const byVisitor = {};
  for (const k of keys) { const [v, f] = k.split("/"); (byVisitor[v] ||= []).push({ key: k, kind: f.endsWith("-after.json.gz") ? "after" : "before", ts: f.slice(0, 24) }); }
  const sessions = [];
  const tot = { libraries: 0, downloads: 0, fixesOffered: 0, fixesAccepted: 0, gemsOffered: 0, gemsKept: 0, crates: 0, tidyOffered: 0, tidyTicked: 0, gemsLoved: 0, gemsSkipped: 0, gemsKnew: 0 };
  const byField = {}; // field|confidence -> {offered, accepted}
  for (const [v, list] of Object.entries(byVisitor)) {
    list.sort((a, b) => (a.ts < b.ts ? -1 : 1));
    let lastBefore = null;
    for (const item of list) {
      if (item.kind === "before") { lastBefore = item; tot.libraries++; continue; }
      const after = await getShare(item.key, req); if (!after) continue;
      const before = lastBefore ? await getShare(lastBefore.key, req) : null;
      tot.downloads++;
      const s = { visitor: v.slice(0, 8), at: after.at, tracks: before?.tracks?.length || after.tracks || null, played: before ? before.tracks.filter((t) => t.plays > 0).length : null };
      const acc = new Set((after.fixes || []).map((f) => `${f[0]}|${f[1]}`));
      if (before) {
        const r = analyse(before.tracks.map((t) => ({ ...t })));
        s.fixesOffered = r.fixes.length; s.gemsOffered = r.gemsFlat.length; s.tidyOffered = r.tidy.length;
        for (const f of r.fixes) { const k = `${f.field}|${f.confidence}`; byField[k] ||= { offered: 0, accepted: 0 }; byField[k].offered++; if (acc.has(`${f.id}|${f.field}`)) byField[k].accepted++; }
        tot.fixesOffered += r.fixes.length; tot.tidyOffered += r.tidy.length;
      }
      s.fixesAccepted = (after.fixes || []).length;
      s.gemsKept = (after.gems || []).filter((g) => g[3]).length; s.gemsListed = (after.gems || []).length;
      s.gemsLoved = (after.gems || []).filter((g) => g[4] === 1).length; s.gemsSkipped = (after.gems || []).filter((g) => g[4] === -1).length; s.gemsKnew = (after.gems || []).filter((g) => g[4] === 2).length;
      tot.gemsLoved += s.gemsLoved; tot.gemsSkipped += s.gemsSkipped; tot.gemsKnew += s.gemsKnew;
      const marked = s.gemsLoved + s.gemsSkipped + s.gemsKnew; s.hitRate = marked ? Math.round((100 * s.gemsLoved) / marked) : null;
      s.crates = (after.mixes || []).length; s.tidyTicked = (after.tidy || []).length;
      tot.fixesAccepted += s.fixesAccepted; tot.gemsOffered += s.gemsListed; tot.gemsKept += s.gemsKept; tot.crates += s.crates; tot.tidyTicked += s.tidyTicked;
      sessions.push(s);
    }
  }
  const rate = (a, b) => (b ? Math.round((100 * a) / b) : null);
  // v0.6.2: crate reactions from anonymous react/ events
  const ev = getStore({ name: storeName("events", req), consistency: "strong" });
  const { blobs: rb } = await ev.list({ prefix: "react/" });
  const reacts = (await Promise.all(rb.map((b) => ev.get(b.key, { type: "json" })))).filter(Boolean);
  const n = (side, r) => reacts.filter((e) => e.side === side && e.r === r).length;
  const re = { bagPlay: n("bag", "play"), bagNo: n("bag", "no"), shelfWant: n("shelf", "want"), shelfHave: n("shelf", "have"), shelfNo: n("shelf", "no") };
  const reactions = { ...re, bagHitRate: rate(re.bagPlay, re.bagPlay + re.bagNo), shelfHitRate: rate(re.shelfWant + re.shelfHave, re.shelfWant + re.shelfHave + re.shelfNo) };
  return json({
    generatedAt: new Date().toISOString(), reactions, totals: { ...tot, ...reactions, fixAcceptRate: rate(tot.fixesAccepted, tot.fixesOffered), gemKeepRate: rate(tot.gemsKept, tot.gemsOffered), gemHitRate: rate(tot.gemsLoved, tot.gemsLoved + tot.gemsSkipped + tot.gemsKnew) },
    byField: Object.entries(byField).map(([k, v]) => { const [field, confidence] = k.split("|"); return { field, confidence, ...v, rate: rate(v.accepted, v.offered) }; }).sort((a, b) => b.offered - a.offered),
    sessions: sessions.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 100),
    librariesWithoutDownload: tot.libraries - tot.downloads > 0 ? tot.libraries - tot.downloads : 0,
  });
};

export const config = { path: "/api/insights" };
