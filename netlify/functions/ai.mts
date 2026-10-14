// BINDIG v0.5 AI: /api/ai/profile writes the DJ profile; /api/ai/crate digs one crate of ten-ish tracks.
// Claude runs through the Netlify AI Gateway (no key to manage). Answers stream back as plain text so long digs
// never hit the 60 s function limit. The first crate is free via a signed ticket from the profile call;
// extra crates need a paid ticket from /api/verify. Every ticket works once.
import Anthropic from "@anthropic-ai/sdk";
import { getStore } from "@netlify/blobs";
import { json, env, signToken, verifyToken, storeName } from "../../lib/http.mts";
import { record } from "../../lib/track.mts";
import { cleanProfile, cleanCrate, profilePrompt, cratePrompt } from "../../lib/dig-ai.mts";

const ERR = "\u0000BINDIG_ERROR:";
const MODEL_PROFILE = () => env("BINDIG_MODEL_PROFILE") || "claude-sonnet-5-5";
const MODEL_CRATE = () => env("BINDIG_MODEL_CRATE") || "claude-opus-5-5";

function streamClaude(model: string, prompt: string, maxTokens: number, extra: Record<string, unknown>, onFail?: () => Promise<void>, onDone?: () => void) {
  const enc = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      const t0 = Date.now();
      try {
        const client = new Anthropic();
        const stream = client.messages.stream({ model, max_tokens: maxTokens, ...extra, messages: [{ role: "user", content: prompt }] } as any);
        stream.on("text", (d) => controller.enqueue(enc.encode(d)));
        const msg = await stream.finalMessage();
        console.log("claude done", model, msg.stop_reason, msg.usage?.output_tokens, `${Date.now() - t0}ms`);
        if (msg.stop_reason === "max_tokens") controller.enqueue(enc.encode(ERR + "cut_short"));
        onDone?.();
      } catch (e: any) {
        console.error("claude call failed", model, e?.status, e?.message);
        try { await onFail?.(); } catch {}
        controller.enqueue(enc.encode(ERR + (e?.status === 429 ? "busy" : "failed")));
      }
      controller.close();
    },
  });
}

// Crate: two half-size digs run side by side (fresh+classic, deep cuts) so the whole thing finishes well inside
// the function limit. Spaces trickle out while Claude thinks, so the CDN never sees a silent connection.
function crateStream(model: string, prompts: string[], effort: string, onFail: () => Promise<void>) {
  const enc = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      const t0 = Date.now();
      controller.enqueue(enc.encode(" "));
      const beat = setInterval(() => { try { controller.enqueue(enc.encode(" ")); } catch {} }, 4000);
      try {
        const client = new Anthropic();
        const parts = await Promise.all(prompts.map(async (p) => {
          const msg = await client.messages.create({ model, max_tokens: 8000, output_config: { effort }, messages: [{ role: "user", content: p }] } as any);
          const text = (msg.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
          console.log("claude crate part", model, msg.stop_reason, msg.usage?.output_tokens, `${Date.now() - t0}ms`);
          const a = text.indexOf("["), b = text.lastIndexOf("]");
          try { return a >= 0 && b > a ? JSON.parse(text.slice(a, b + 1)) : []; } catch { return []; }
        }));
        const picks = parts.flat().filter((x: any) => x && x.artist && x.title);
        clearInterval(beat);
        if (!picks.length) { await onFail(); controller.enqueue(enc.encode(ERR + "failed")); }
        else controller.enqueue(enc.encode(JSON.stringify(picks)));
      } catch (e: any) {
        clearInterval(beat);
        console.error("claude crate failed", model, e?.status, e?.message);
        try { await onFail(); } catch {}
        controller.enqueue(enc.encode(ERR + (e?.status === 429 ? "busy" : "failed")));
      }
      controller.close();
    },
  });
}

const textHeaders = (extra: Record<string, string> = {}) => ({ "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", ...extra });

export default async (req: Request, context: any) => {
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  if (!env("ANTHROPIC_BASE_URL") && !env("ANTHROPIC_API_KEY")) return json({ error: "The AI isn't switched on for this site yet." }, 503);
  const secret = env("UNLOCK_SECRET");
  if (!secret) return json({ error: "Crates aren't switched on yet." }, 503);
  let body: any; try { body = await req.json(); } catch { return json({ error: "Couldn't read the request." }, 400); }
  const kind = new URL(req.url).pathname.endsWith("/crate") ? "crate" : "profile";

  if (kind === "profile") {
    const profile = cleanProfile(body?.profile);
    if (!profile) return json({ error: "That profile is missing or too big." }, 400);
    const lead = String(profile?.leadCrate?.name || "").slice(0, 60);
    const ticket = lead ? signToken({ kind: "crate-free", crate: lead, jti: `free-${crypto.randomUUID()}`, exp: Date.now() + 12 * 3600 * 1000 }, secret) : "";
    context.waitUntil?.(record("profile", { tracks: Number(profile.tracks) || 0, ageMonths: Number(profile.collectionAgeMonths) || 0, lead }, req, context));
    return new Response(// Profile: no up-front thinking (between_tools is Sonnet 5.5's lowest setting) so it answers fast.
    streamClaude(MODEL_PROFILE(), profilePrompt(profile), 4000, { thinking: { type: "between_tools" } }), { headers: textHeaders(ticket ? { "x-bindig-ticket": ticket } : {}) });
  }

  // crate
  const crate = cleanCrate(body?.crate);
  if (!crate) return json({ error: "Pick a crate first." }, 400);
  const t = verifyToken((req.headers.get("authorization") || "").replace(/^Bearer\s+/i, ""), secret);
  if (!t || !["crate-free", "crate-paid"].includes(t.kind) || !t.jti) return json({ error: "This crate isn't unlocked yet.", code: "locked" }, 402);
  if (t.crate !== crate.name) return json({ error: `That pass is for a ${t.crate} crate.`, code: "wrong_crate" }, 403);
  let used: any = null;
  try {
    used = getStore({ name: storeName("crate-tickets", req), consistency: "strong" });
    if (await used.get(t.jti)) return json({ error: "That crate pass has already been used.", code: "used" }, 409);
    await used.set(t.jti, new Date().toISOString());
  } catch (e: any) { console.error("ticket store failed", e?.message); }
  const owned = (Array.isArray(body?.owned) ? body.owned : []).slice(0, 300).map((x: unknown) => String(x).slice(0, 80));
  const already = (Array.isArray(body?.already) ? body.already : []).slice(0, 60).map((x: unknown) => String(x).slice(0, 120));
  const args = [crate, body?.reading, owned, already, Number(body?.recentWindowMonths) || 18] as const;
  const prompts = [cratePrompt(...args, "A"), cratePrompt(...args, "B")];
  context.waitUntil?.(record("crate", { crate: crate.name, paid: t.kind === "crate-paid" }, req, context));
  // A failed dig gives the pass back so the DJ can try again.
  return new Response(crateStream(MODEL_CRATE(), prompts, env("BINDIG_CRATE_EFFORT") || "low", async () => { await used?.delete(t.jti); }), { headers: textHeaders() });
};

export const config = {
  path: ["/api/ai/profile", "/api/ai/crate"],
  method: "POST",
  rateLimit: { windowLimit: 12, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
