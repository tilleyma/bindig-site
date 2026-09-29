// Beta library sharing (opt-in only). Stores a compressed copy of the scanned library ("before")
// and the choices made at download ("after") so the owner can check how useful BINDIG is.
// No file paths are ever sent. Delete the "beta" store when the beta ends.
import { getStore } from "@netlify/blobs";
import { gzipSync, gunzipSync } from "node:zlib";
import { storeName } from "./http.mts";

const store = (req) => getStore({ name: storeName("beta", req), consistency: "strong" });
const who = (req) => (req?.headers?.get("x-bindig-visitor") || "anon").replace(/[^a-z0-9-]/gi, "").slice(0, 40) || "anon";
export const optedIn = (req) => req?.headers?.get("x-bindig-share") === "1";

export async function saveShare(kind, payload, req, context) {
  try {
    const now = new Date();
    const key = `${who(req)}/${now.toISOString().replace(/[:.]/g, "-")}-${kind}.json.gz`;
    const body = gzipSync(Buffer.from(JSON.stringify({ kind, at: now.toISOString(), country: context?.geo?.country?.code || null, ...payload })));
    await store(req).set(key, body);
    return key;
  } catch (e) { console.error("share failed", kind, e?.message); return null; }
}

export async function listShares(req) {
  const { blobs } = await store(req).list();
  return blobs.map((b) => b.key).sort();
}
export async function getShare(key, req) {
  const buf = await store(req).get(key, { type: "arrayBuffer" });
  return buf ? JSON.parse(gunzipSync(Buffer.from(buf)).toString("utf8")) : null;
}
export async function clearShares(req) {
  const s = store(req); const { blobs } = await s.list();
  await Promise.all(blobs.map((b) => s.delete(b.key))); return blobs.length;
}
