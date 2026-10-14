// BINDIG v0.5.1 genre check: looks up the DJ's seed tracks and the AI's candidate picks on Discogs and returns
// each one's styles, year, label and how many people own it. The page builds a style fingerprint from the seeds
// and keeps only picks that fit it. Needs DISCOGS_TOKEN (personal access token, read-only).
// Lookups are cached in Blobs so repeat crates cost fewer Discogs calls (limit: 60 a minute per token).
import { getStore } from "@netlify/blobs";
import { json, env, verifyToken, storeName } from "../../lib/http.mts";

type Pair = { artist: string; title: string };
type Hit = { found: boolean; styles: string[]; genres: string[]; have: number; want: number; year: number; label: string; url: string } | { found: false; limited?: boolean };

const clean = (x: string) => String(x || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const firstArtist = (a: string) => String(a || "").split(/\s*(?:,|&|\bfeat\.?|\bft\.?|\bx\b|\bvs\.?)\s*/i)[0].trim();
const bareTitle = (t: string) => String(t || "").replace(/\s*[\(\[][^\)\]]*[\)\]]/g, " ").replace(/\s+-\s+.*$/, "").trim();

async function lookup(p: Pair, token: string, cache: any, state: { limited: boolean }): Promise<Hit> {
  const artist = firstArtist(p.artist).slice(0, 80), title = bareTitle(p.title).slice(0, 120);
  if (!artist || !title) return { found: false };
  const key = `v1/${clean(artist)}|${clean(title)}`.slice(0, 200);
  try { const c = await cache?.get(key, { type: "json" }); if (c) return c; } catch {}
  if (state.limited) return { found: false, limited: true };
  const u = new URL("https://api.discogs.com/database/search");
  u.searchParams.set("type", "release"); u.searchParams.set("artist", artist); u.searchParams.set("track", title); u.searchParams.set("per_page", "5");
  const r = await fetch(u, { headers: { "user-agent": "BINDIG/0.5 +https://bindig.netlify.app", authorization: `Discogs token=${token}` } });
  if (r.status === 429) { state.limited = true; return { found: false, limited: true }; }
  if (!r.ok) return { found: false };
  const d = await r.json();
  const A = clean(artist).split(" ")[0];
  const res = (d.results || []).find((x: any) => clean(x.title).includes(A)) || null;
  const hit: Hit = res
    ? { found: true, styles: (res.style || []).slice(0, 8), genres: (res.genre || []).slice(0, 4), have: res.community?.have || 0, want: res.community?.want || 0,
        year: Number(res.year) || 0, label: (res.label || [])[0] || "", url: res.uri ? `https://www.discogs.com${res.uri}` : "" }
    : { found: false };
  try { await cache?.setJSON(key, hit); } catch {}
  return hit;
}

async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; try { out[k] = await fn(items[k]); } catch { out[k] = { found: false } as any; } } }));
  return out;
}

export default async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  const token = env("DISCOGS_TOKEN") || env("DISCOGS_KEY");
  if (!token) return json({ error: "Genre check isn't switched on.", code: "off" }, 503);
  const t = verifyToken((req.headers.get("authorization") || "").replace(/^Bearer\s+/i, ""), env("UNLOCK_SECRET"));
  if (!t || !["crate-free", "crate-paid"].includes(t.kind)) return json({ error: "This crate isn't unlocked.", code: "locked" }, 402);
  let body: any; try { body = await req.json(); } catch { return json({ error: "Couldn't read the request." }, 400); }
  const pairs = (v: unknown, n: number): Pair[] => (Array.isArray(v) ? v.slice(0, n) : []).map((x: any) => ({ artist: String(x?.artist || "").slice(0, 120), title: String(x?.title || "").slice(0, 160) }));
  const seeds = pairs(body?.seeds, 12), candidates = pairs(body?.candidates, 30);
  let cache: any = null; try { cache = getStore({ name: storeName("discogs-cache", req) }); } catch {}
  const state = { limited: false };
  const [s, c] = await Promise.all([pool(seeds, 3, (p) => lookup(p, token, cache, state)), pool(candidates, 4, (p) => lookup(p, token, cache, state))]);
  return json({ seeds: s, candidates: c, limited: state.limited });
};

export const config = { path: "/api/genre-check", method: "POST", rateLimit: { windowLimit: 10, windowSize: 60, aggregateBy: ["ip", "domain"] } };
