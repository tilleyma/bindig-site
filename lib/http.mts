// Shared helpers for BINDIG functions.
import { createHmac, timingSafeEqual } from "node:crypto";

export const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export const COLS = ["id", "artist", "title", "album", "genre", "year", "comments", "label", "bpm", "key", "plays", "rating", "added", "bitrate", "time", "kind", "tn", "cues", "lists"];

// Client sends { cols, rows } (compact) to stay under the request size limit.
export async function readTracks(req) {
  let body;
  try { body = await req.json(); } catch { return { error: "Couldn't read the upload." }; }
  const cols = body?.cols, rows = body?.rows;
  if (!Array.isArray(cols) || !Array.isArray(rows)) return { error: "Upload is missing track data." };
  if (rows.length === 0) return { error: "No tracks found in that file." };
  if (rows.length > 40000) return { error: "Libraries over 40,000 tracks aren't supported yet." };
  const idx = Object.fromEntries(cols.map((c, i) => [c, i]));
  const num = new Set(["bpm", "plays", "rating", "bitrate", "time", "tn", "cues", "lists"]);
  const tracks = rows.map((r) => {
    const t = {};
    for (const c of COLS) { const v = idx[c] !== undefined ? r[idx[c]] : undefined; t[c] = num.has(c) ? Number(v) || 0 : v == null ? "" : String(v).slice(0, 500); }
    return t;
  });
  const ids = (a) => (Array.isArray(a) ? a.slice(0, 20000).map((x) => String(x).slice(0, 40)) : []);
  const prefs = { love: ids(body?.prefs?.love), skip: ids(body?.prefs?.skip) };
  const f = body?.focus;
  const focus = f && typeof f === "object" ? { genres: Array.isArray(f.genres) ? f.genres.slice(0, 20).map((g) => String(g).slice(0, 80)) : [], bpmLo: Number(f.bpmLo) || 0, bpmHi: Number(f.bpmHi) || 0, minutes: Number(f.minutes) || 60, vibe: ["warm", "peak", "any"].includes(f.vibe) ? f.vibe : "any", seed: Number(f.seed) || 1 } : null;
  return { tracks, prefs, focus };
}

const b64u = (b) => Buffer.from(b).toString("base64url");

export function signToken(payload, secret) {
  const body = b64u(JSON.stringify(payload));
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyToken(token, secret) {
  if (!token || !secret) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const want = createHmac("sha256", secret).update(body).digest("base64url");
  const a = Buffer.from(sig), b = Buffer.from(want);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString());
    if (!p.exp || Date.now() > p.exp) return null;
    return p;
  } catch { return null; }
}

export const env = (k) => (globalThis.Netlify?.env?.get?.(k)) ?? process.env[k];

// Sandbox = any Netlify deploy preview or branch deploy (host contains "--"), or local dev.
// Sandbox uses Stripe test mode and separate storage, so testing never touches production data or payments.
export function isSandbox(req) {
  try { const h = new URL(req.url).hostname; return h.includes("--") || h === "localhost" || h === "127.0.0.1"; } catch { return false; }
}
export const storeName = (name, req) => (isSandbox(req) ? `${name}-sandbox` : name);
export const stripeKey = (req) => (isSandbox(req) ? env("STRIPE_TEST_SECRET_KEY") || "" : env("STRIPE_SECRET_KEY"));
