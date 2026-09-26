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
  return { tracks };
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
