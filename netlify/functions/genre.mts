// BINDIG v0.5.1 genre check: looks up the DJ's seed tracks and the AI's candidate picks on Discogs and returns
// each one's styles, year, label and how many people own it. The page builds a style fingerprint from the seeds
// and keeps only picks that fit it. Needs DISCOGS_TOKEN (personal access token, read-only).
// Lookups are cached in Blobs so repeat crates cost fewer Discogs calls (limit: 60 a minute per token).
import Anthropic from "@anthropic-ai/sdk";
import { getStore } from "@netlify/blobs";
import { json, env, verifyToken, storeName } from "../../lib/http.mts";

type Pair = { artist: string; title: string };
type Hit = { found: boolean; styles: string[]; genres: string[]; have: number; want: number; year: number; label: string; url: string } | { found: false; limited?: boolean };

const clean = (x: string) => String(x || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const firstArtist = (a: string) => String(a || "").split(/\s*(?:,|&|\bfeat\.?|\bft\.?|\bx\b|\bvs\.?)\s*/i)[0].trim();
const bareTitle = (t: string) => String(t || "").replace(/\s*[\(\[][^\)\]]*[\)\]]/g, " ").replace(/\s+-\s+.*$/, "").trim();

async function lookup(p: Pair, token: string | undefined, cache: any, state: { limited: boolean; logged?: boolean; diag: string[] }): Promise<Hit> {
  const artist = firstArtist(p.artist).slice(0, 80), title = bareTitle(p.title).slice(0, 120);
  if (!artist || !title) return { found: false };
  const key = `v2/${clean(artist)}|${clean(title)}`.slice(0, 200);
  try { const c = await cache?.get(key, { type: "json" }); if (c && c.found) return c; } catch {}
  if (state.limited) return { found: false, limited: true };
  if (!token) return { found: false };
  const search = async (params: Record<string, string>) => {
    const u = new URL("https://api.discogs.com/database/search");
    u.searchParams.set("type", "release"); u.searchParams.set("per_page", "10");
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    const r = await fetch(u, { headers: { "user-agent": "BINDIG/0.5 +https://bindig.netlify.app", authorization: `Discogs token=${token}` } });
    if (r.status === 429) { state.limited = true; return null; }
    if (!r.ok) { if (state.diag.length < 3) state.diag.push(`http ${r.status}: ${(await r.text()).slice(0, 120)}`); return null; }
    return (await r.json()).results || [];
  };
  // exact track search first; digital-only EPs are often only found by a looser search
  let results = await search({ artist, track: title });
  if (results && !results.length && !state.limited) results = await search({ q: `${artist} ${title}` });
  if (!results) return { found: false, limited: state.limited } as Hit;
  const A = clean(artist).split(" ")[0];
  const BOOT = /\b(bootleg|rawstyle|hardstyle|unofficial|flip|mashup)\b/i;
  const ok = results.filter((x: any) => { const tt = clean(x.title); return tt.includes(A) && !BOOT.test(x.title || ""); });
  // prefer the real release: most owned + wanted, and not a self-released "Not On Label" upload
  const res = ok.sort((a: any, b: any) => ((b.community?.have || 0) + (b.community?.want || 0) - (/^not on label/i.test((b.label || [])[0] || "") ? 1e6 : 0))
    - ((a.community?.have || 0) + (a.community?.want || 0) - (/^not on label/i.test((a.label || [])[0] || "") ? 1e6 : 0)))[0] || null;
  if (!res && state.diag.length < 3) state.diag.push(`no match: ${results.length} results`);
  const hit: Hit = res
    ? { found: true, styles: (res.style || []).slice(0, 8), genres: (res.genre || []).slice(0, 4), have: res.community?.have || 0, want: res.community?.want || 0,
        year: Number(res.year) || 0, label: (res.label || [])[0] || "", url: res.uri ? `https://www.discogs.com${res.uri}` : "" }
    : { found: false };
  if (hit.found) { try { await cache?.setJSON(key, hit); } catch {} }
  return hit;
}

async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>, diag?: string[]): Promise<R[]> {
  const out: R[] = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; try { out[k] = await fn(items[k]); } catch (e: any) { if (diag && diag.length < 3) diag.push(`error: ${String(e?.message || e).slice(0, 120)}`); out[k] = { found: false } as any; } } }));
  return out;
}

/* ---------- AI genre judge: is each pick really in this crate, or a neighbouring genre? ---------- */
// Discogs can't split Organic / Afro / Melodic House; a quick Sonnet pass, anchored on the DJ's own tracks, can.
async function judge(crate: { name: string; seeds: string[]; neighbours: string[] }, picks: any[]) {
  if (!picks.length || !crate.name || (!env("ANTHROPIC_API_KEY") && !env("ANTHROPIC_BASE_URL"))) return null;
  const neighbours = crate.neighbours.filter((n) => n && n !== crate.name);
  const prompt = `You are a strict genre editor at Beatport. A DJ's ${crate.name} crate is defined by these tracks they own and play:
${crate.seeds.map((x) => `- ${x}`).join("\n") || "- (none listed)"}

For each candidate below, decide where Beatport would file it: "${crate.name}" or one of these neighbours: ${neighbours.join(", ") || "other"}. Use "other" for anything else.
Judge the track itself, not the artist's usual genre. Be strict: if it would sound out of place next to the tracks above in a ${crate.name} set, it is not ${crate.name}.
If you don't know the exact track, judge from what that artist and label were releasing around that year, and set confidence 0.5-0.65. Use "unknown" only if you know neither the artist nor the label.

Candidates:
${picks.map((p, i) => `${i}. ${p.artist} – ${p.title}${p.label ? ` [${p.label}${p.year ? ", " + p.year : ""}]` : ""}${p.styles?.length ? ` (Discogs: ${p.styles.join("/")})` : ""}`).join("\n")}

Reply with only a JSON array, one object per candidate, in order:
[{"i":0,"genre":"<${crate.name} | a neighbour | other | unknown>","confidence":0.0}]`;
  try {
    const client = new Anthropic();
    const msg: any = await Promise.race([
      client.messages.create({ model: env("BINDIG_MODEL_JUDGE") || "claude-sonnet-5-5", max_tokens: 3000, thinking: { type: "between_tools" }, messages: [{ role: "user", content: prompt }] } as any),
      new Promise((_, rej) => setTimeout(() => rej(new Error("judge timeout")), 22000)),
    ]);
    const text = (msg.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
    const a = text.indexOf("["), b = text.lastIndexOf("]");
    const arr = a >= 0 && b > a ? JSON.parse(text.slice(a, b + 1)) : [];
    const out = picks.map(() => null as null | { genre: string; confidence: number });
    for (const x of arr) if (x && Number.isInteger(x.i) && x.i >= 0 && x.i < out.length) out[x.i] = { genre: String(x.genre || "unknown").slice(0, 60), confidence: Math.max(0, Math.min(1, Number(x.confidence) || 0)) };
    return out;
  } catch (e: any) { console.error("genre judge failed", e?.message); return null; }
}

export default async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  const token = env("DISCOGS_TOKEN") || env("DISCOGS_KEY");
  const t = verifyToken((req.headers.get("authorization") || "").replace(/^Bearer\s+/i, ""), env("UNLOCK_SECRET"));
  if (!t || !["crate-free", "crate-paid"].includes(t.kind)) return json({ error: "This crate isn't unlocked.", code: "locked" }, 402);
  let body: any; try { body = await req.json(); } catch { return json({ error: "Couldn't read the request." }, 400); }
  const pairs = (v: unknown, n: number): Pair[] => (Array.isArray(v) ? v.slice(0, n) : []).map((x: any) => ({ artist: String(x?.artist || "").slice(0, 120), title: String(x?.title || "").slice(0, 160) }));
  const seeds = pairs(body?.seeds, 12), candidates = pairs(body?.candidates, 30);
  let cache: any = null; try { cache = getStore({ name: storeName("discogs-cache", req) }); } catch {}
  const state = { limited: false, diag: [] as string[] };
  const raw = Array.isArray(body?.candidates) ? body.candidates.slice(0, 30) : [];
  const crate = { name: String(body?.crate?.name || "").slice(0, 60),
    seeds: (Array.isArray(body?.crate?.seeds) ? body.crate.seeds : []).slice(0, 25).map((x: unknown) => String(x).slice(0, 160)),
    neighbours: (Array.isArray(body?.crate?.neighbours) ? body.crate.neighbours : []).slice(0, 10).map((x: unknown) => String(x).slice(0, 60)) };
  const t0 = Date.now();
  // Discogs look-ups and the AI judge run side by side so the whole check stays well under the 30 s CDN window
  const [s, c, verdicts] = await Promise.all([
    pool(seeds, 3, (p) => lookup(p, token, cache, state), state.diag),
    pool(candidates, 4, (p) => lookup(p, token, cache, state), state.diag),
    judge(crate, candidates.map((p, i) => ({ ...p, label: String(raw[i]?.label || "").slice(0, 80), year: Number(raw[i]?.year) || 0 }))),
  ]);
  console.log("genre-check", crate.name, `${candidates.length} picks`, verdicts ? "judged" : "no judge", `${Date.now() - t0}ms`);
  if (state.diag.length) console.error("genre-check diag", state.diag);
  return json({ seeds: s, candidates: c, verdicts, limited: state.limited, diag: state.diag });
};

export const config = { path: "/api/genre-check", method: "POST", rateLimit: { windowLimit: 10, windowSize: 60, aggregateBy: ["ip", "domain"] } };
