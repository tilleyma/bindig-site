// BINDIG analysis engine v0.2 — runs server-side only.
// Input: slim track list from a Rekordbox XML. Output: tag fixes, purge suggestions, health summary.
// Rules learned from the pilot: never swap a specific genre for a broader one; never guess a genre without evidence.

export const CORE_GENRES = [
  "House", "Deep House", "Tech House", "Progressive House", "Melodic House & Techno", "Organic House",
  "Afro House", "Minimal House", "Techno", "Indie Dance", "Nu Disco", "Disco", "Electronica", "Downtempo",
  "Breaks", "Trance", "Drum & Bass", "Dubstep", "UK Garage", "Hip-Hop", "Pop", "Funk / Soul",
];

// Exact spelling or typo fixes only. Nothing here moves a track to a broader genre.
const GENRE_ALIASES = {
  "progressie house": "Progressive House",
  "progresive house": "Progressive House",
  "progressive": "Progressive House",
  "deep-house": "Deep House",
  "tech-house": "Tech House",
  "melodic house and techno": "Melodic House & Techno",
  "melodic house & techno": "Melodic House & Techno",
  "melodic techno": "Melodic House & Techno",
  "nu-disco": "Nu Disco",
  "nudisco": "Nu Disco",
  "indie-dance": "Indie Dance",
  "afrohouse": "Afro House",
  "drum and bass": "Drum & Bass",
  "dnb": "Drum & Bass",
  "hip hop": "Hip-Hop",
};

const SITE_TLD = "(?:com|pl|info|club|net|org|biz|ru|me|to|cc|io|xyz|eu)";
const JUNK_BRACKET = new RegExp(`\\s*[\\[(](?:www\\.)?[\\w.-]+\\.${SITE_TLD}[\\])]`, "gi");
const JUNK_TAIL = new RegExp(`\\s*[-–|]\\s*(?:www\\.)?[\\w.-]+\\.${SITE_TLD}\\s*$`, "i");
// A trailing bare domain in a title/artist, e.g. "Track Name DeepDJ.org". Only when the name looks like a DJ/download site,
// so artist names with dots (Mr.Oizo) are left alone.
const JUNK_BARE = /\s+(?:www\.)?[\w-]*(?:dj|mp3|music|club|promo|download|house|techno|beat|track|zone|crate|fresh|exclusive|pool|remix)[\w-]*\.(?:[a-z]{2,6})(?:\.[a-z]{2})?\s*$/i;
const JUNK_URL = /[\s_]*(?:[«»øº*~]+\s*)*(?:https?:\/\/|www\.)\S+(?:\s*[«»øº*~]+)*|\s+[\w.-]+\.blogspot\.com\b/gi;
const JUNK_ANY = new RegExp(`(?:https?://\\S+|www\\.\\S+|\\b[\\w-]+\\.${SITE_TLD}\\b)`, "gi");

const norm = (s) => (s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
const primaryArtist = (a) => (a || "").split(/\s*(?:,|&|\/|;| feat\.? | ft\.? | x | vs\.? )\s*/i)[0].trim();
const tidy = (s) => s.replace(/\s{2,}/g, " ").replace(/\s+([)\]])/g, "$1").replace(/[\s\-–|]+$/g, "").trim();

function looksLikeJunkGenre(g) {
  return /\.(com|pl|info|club|net|org|biz|ru)\b/i.test(g) || /^(dj|mp3|music|club|www)/i.test(g) && /\./.test(g);
}

// Comments: keep the Mixed In Key prefix ("8A - Energy 6") and any personal notes; drop download-site junk.
// Store receipts ("Purchased at Beatport.com") are offered separately as an optional, medium-confidence fix.
const DOMAIN = /(?:https?:\/\/|www\.)\S+|\b[\w-]+(?:\.[\w-]+)*\.(?:com|org|net|info|club|pl|ru|uk|co|lt|lv|me|to|cc|io|xyz|eu|biz|de|fr|nl|es|it|us|fm|dj|top|site|online|store|live|in|tv|ws|su|ua|by|mx|br|cz|sk|hu|ro|gr|tk|ml|cf|ga|gq)(?:\/\S*)?\b/i;
const STORE = /^(?:purchased (?:at|from)|bought (?:at|from)|delivered by|amazon\.com song id|itunes|bandcamp|juno(?:download)?|traxsource|beatport)\b/i;
const CREDIT = /^(?:(?:rlz|ripped|uploaded|shared|posted|downloaded|download)(?:\s+(?:by|from|at))?|by|from|free download|visit)\b/i;
function cleanComments(c) {
  const m = /^\s*(\d{1,2}[AB]\s*-\s*Energy\s*\d+)\s*(?:-\s*)?(.*)$/i.exec(c);
  const prefix = m ? m[1].trim() : "";
  const rest = m ? m[2] : c;
  const segs = rest.split(/\s+-\s+|\s*,\s+|\s+\|\s+/).map((x) => x.trim()).filter(Boolean);
  const kept = [], keptNoStore = [];
  let junk = false, store = false;
  segs.forEach((seg, i) => {
    const isStore = STORE.test(seg);
    const isJunk = !isStore && (DOMAIN.test(seg) || (CREDIT.test(seg) && segs.some((o, j) => j !== i && DOMAIN.test(o) && !STORE.test(o))) || /^downloaded from\b/i.test(seg) || /^rlz by\b/i.test(seg));
    if (isJunk) { junk = true; return; }
    kept.push(seg);
    if (isStore) { store = true; return; }
    keptNoStore.push(seg);
  });
  const join = (arr) => [prefix, ...arr].filter(Boolean).join(" - ").replace(/\s*-\s*$/, "").trim();
  const withoutJunk = join(kept);
  const withoutStore = join(keptNoStore);
  return { junk: junk && withoutJunk !== c.trim(), withoutJunk, store, withoutStore: withoutStore };
}

export function analyse(tracks) {
  const fixes = [];
  const add = (t, field, to, rule, confidence) => {
    const from = t[field] ?? "";
    if (String(from) === String(to)) return;
    fixes.push({ id: t.id, field, from, to, rule, confidence, artist: t.artist, title: t.title });
    t["_" + field] = to;
  };
  const cur = (t, f) => (t["_" + f] !== undefined ? t["_" + f] : t[f] || "");

  // Pass 1: text clean-up
  for (const t of tracks) {
    let title = t.title || "";
    let artist = t.artist || "";
    const strippedTitle = title.replace(JUNK_URL, "").replace(JUNK_BRACKET, "").replace(JUNK_TAIL, "").replace(JUNK_BARE, "");
    const cleanedTitle = tidy(strippedTitle);
    if (strippedTitle !== title && cleanedTitle) { add(t, "title", cleanedTitle, "Download-site text removed", "high"); title = cleanedTitle; }
    const strippedArtist = artist.replace(JUNK_URL, "").replace(JUNK_BRACKET, "").replace(JUNK_TAIL, "").replace(JUNK_BARE, "");
    const cleanedArtist = tidy(strippedArtist);
    if (strippedArtist !== artist && cleanedArtist) { add(t, "artist", cleanedArtist, "Download-site text removed", "high"); artist = cleanedArtist; }
    if (artist && title.toLowerCase().startsWith(artist.toLowerCase() + " - ")) {
      const rest = title.slice(artist.length + 3).trim();
      if (rest.length >= 2) add(t, "title", rest, "Artist name repeated in the title", "high");
    }
    const cc = cleanComments(t.comments || "");
    if (cc.junk) add(t, "comments", cc.withoutJunk, "Download-site text removed from comments", "high");
    if (cc.store) add(t, "comments", cc.withoutStore, "Store receipt removed from comments (optional)", "medium");
    const g = (t.genre || "").trim();
    if (g) {
      const alias = GENRE_ALIASES[g.toLowerCase()];
      const caseFix = CORE_GENRES.find((x) => x.toLowerCase() === g.toLowerCase());
      if (alias && alias !== g) add(t, "genre", alias, "Genre spelling standardised", "high");
      else if (caseFix && caseFix !== g) add(t, "genre", caseFix, "Genre capitalisation standardised", "high");
      else if (looksLikeJunkGenre(g)) add(t, "genre", "", "Website name found in the genre field", "high");
    }
  }

  // Pass 2: artist spelling — only case/punctuation variants, majority spelling wins
  const spellings = new Map();
  for (const t of tracks) {
    const a = cur(t, "artist"); if (!a) continue;
    const k = norm(a); if (!k) continue;
    if (!spellings.has(k)) spellings.set(k, new Map());
    const m = spellings.get(k); m.set(a, (m.get(a) || 0) + 1);
  }
  for (const t of tracks) {
    const a = cur(t, "artist"); const m = spellings.get(norm(a)); if (!m || m.size < 2) continue;
    const total = [...m.values()].reduce((x, y) => x + y, 0);
    const [best, n] = [...m.entries()].sort((x, y) => y[1] - x[1])[0];
    if (best !== a && n / total >= 0.7 && total >= 3) add(t, "artist", best, `Matches the spelling on ${n} of your ${total} tracks by this artist`, "medium");
  }

  // Pass 3: blank genre filled from the same artist's other tracks in this library
  const byArtist = new Map();
  for (const t of tracks) {
    const g = cur(t, "genre"); if (!g) continue;
    const k = norm(primaryArtist(cur(t, "artist"))); if (!k) continue;
    if (!byArtist.has(k)) byArtist.set(k, new Map());
    const m = byArtist.get(k); m.set(g, (m.get(g) || 0) + 1);
  }
  let genreNeedsLookup = 0;
  for (const t of tracks) {
    if (cur(t, "genre")) continue;
    const m = byArtist.get(norm(primaryArtist(cur(t, "artist"))));
    if (m) {
      const total = [...m.values()].reduce((x, y) => x + y, 0);
      const [g, n] = [...m.entries()].sort((x, y) => y[1] - x[1])[0];
      const share = n / total;
      if (total >= 4 && share >= 0.8) { add(t, "genre", g, `Genre of ${n} of your ${total} other tracks by this artist`, "high"); continue; }
      if (total >= 2 && share >= 0.6) { add(t, "genre", g, `Genre of ${n} of your ${total} other tracks by this artist`, "medium"); continue; }
    }
    genreNeedsLookup++;
  }

  // Issues that need an online lookup (flagged, not guessed)
  const yearMissing = tracks.filter((t) => !t.year || t.year === "0").length;
  const labelMissing = tracks.filter((t) => !t.label).length;

  // Duplicates: same artist + title, keep the best copy
  const dupGroups = new Map();
  for (const t of tracks) {
    const k = norm(primaryArtist(cur(t, "artist"))) + "|" + norm(cur(t, "title").replace(/\((original|extended) mix\)/i, ""));
    if (k.length < 4) continue;
    if (!dupGroups.has(k)) dupGroups.set(k, []);
    dupGroups.get(k).push(t);
  }
  const dupOf = new Map();
  for (const g of dupGroups.values()) {
    if (g.length < 2) continue;
    const sorted = [...g].sort((a, b) => (b.plays - a.plays) || (b.bitrate - a.bitrate) || (b.time - a.time));
    for (const t of sorted.slice(1)) dupOf.set(t.id, sorted[0]);
  }

  const purge = purgeModel(tracks, cur, dupOf);

  const fixedIds = new Set(fixes.map((f) => f.id));
  const health = {
    tracks: tracks.length,
    played: tracks.filter((t) => t.plays > 0).length,
    fixable: fixedIds.size,
    fixes: fixes.length,
    byRule: countBy(fixes, (f) => f.rule
      .replace(/^Genre of \d+ of your \d+ other tracks by this artist$/, "Blank genre filled from the artist's other tracks")
      .replace(/^Matches the spelling on \d+ of your \d+ tracks by this artist$/, "Artist spelling matched to the rest of your library")),
    genreNeedsLookup, yearMissing, labelMissing,
    duplicates: dupOf.size,
    purgeCandidates: purge.flat.length,
  };
  const issuesTracks = new Set([...fixedIds, ...dupOf.keys()]);
  health.score = Math.max(0, Math.round(100 * (1 - (issuesTracks.size + genreNeedsLookup * 0.5 + purge.flat.length * 0.5) / Math.max(1, tracks.length))));
  const sets = buildSets(tracks, purge.taste);
  const gaps = findGaps(tracks);
  health.sets = sets.length; health.gapReleases = gaps.totalReleases;
  return { health, fixes, purge: purge.byGenre, purgeFlat: purge.flat, taste: purge.taste, sets, gaps };
}

function countBy(arr, fn) { const m = {}; for (const x of arr) { const k = fn(x); m[k] = (m[k] || 0) + 1; } return m; }

// Taste model v0: learns from what you play (plays > 0 or rated), scores never-played tracks for fit.
function purgeModel(tracks, cur, dupOf) {
  const played = tracks.filter((t) => t.plays > 0 || t.rating > 0);
  const base = played.length / Math.max(1, tracks.length);
  const feat = {
    genre: (t) => cur(t, "genre") || "(none)",
    artist: (t) => norm(primaryArtist(cur(t, "artist"))),
    label: (t) => norm(t.label) || null,
    bpm: (t) => (t.bpm ? Math.round(t.bpm / 4) * 4 : null),
  };
  const stats = {};
  for (const [f, fn] of Object.entries(feat)) {
    const all = new Map(), hit = new Map();
    for (const t of tracks) { const v = fn(t); if (v == null) continue; all.set(v, (all.get(v) || 0) + 1); if (t.plays > 0 || t.rating > 0) hit.set(v, (hit.get(v) || 0) + 1); }
    stats[f] = { all, hit };
  }
  // play rate per value with a prior pulling toward the library base rate
  const aff = (f, v) => { if (v == null) return base; const a = stats[f].all.get(v) || 0, h = stats[f].hit.get(v) || 0; return (h + 3 * base) / (a + 3); };
  const bpms = played.map((t) => t.bpm).filter(Boolean).sort((a, b) => a - b);
  const q = (p) => bpms.length ? bpms[Math.floor(p * (bpms.length - 1))] : 0;
  const bpmLo = q(0.1), bpmHi = q(0.9);
  const now = Date.now();
  const weights = { genre: 0.35, artist: 0.3, label: 0.15, bpm: 0.2 };

  const flat = [];
  for (const t of tracks) {
    if (t.plays > 0 || t.rating > 0) continue;
    const reasons = [];
    let fit = 0;
    for (const [f, w] of Object.entries(weights)) fit += w * aff(f, feat[f](t));
    const rel = fit / Math.max(0.01, base); // 1.0 = average
    let cut = Math.max(0, 1 - rel) * 60;
    const ageYears = t.added ? (now - Date.parse(t.added)) / 3.15e10 : 0;
    if (ageYears >= 2) { cut += Math.min(25, ageYears * 6); reasons.push(`Never played in ${Math.floor(ageYears)} years`); }
    else if (ageYears >= 1) { cut += 8; reasons.push("Never played in over a year"); }
    if (aff("artist", feat.artist(t)) < base * 0.5 && (stats.artist.all.get(feat.artist(t)) || 0) >= 3) reasons.push("An artist you rarely play");
    const g = feat.genre(t);
    if (aff("genre", g) < base * 0.6) reasons.push(`You rarely play ${g === "(none)" ? "untagged tracks" : g}`);
    if (t.bpm && bpmLo && (t.bpm < bpmLo - 4 || t.bpm > bpmHi + 4)) { cut += 10; reasons.push(`${Math.round(t.bpm)} BPM, outside your ${Math.round(bpmLo)}–${Math.round(bpmHi)} range`); }
    if (t.bitrate && t.bitrate < 192 && /mp3/i.test(t.kind || "")) { cut += 10; reasons.push(`Low quality: ${t.bitrate} kbps`); }
    if (t.time && t.time < 90) { cut += 15; reasons.push("Under 90 seconds (sample or loop?)"); }
    const d = dupOf.get(t.id);
    if (d) { cut += 30; reasons.unshift(d.plays > 0 ? "Duplicate: you play the other copy" : `Duplicate: another copy is ${d.bitrate || "?"} kbps`); }
    cut = Math.min(100, Math.round(cut));
    if (cut < 35 || reasons.length === 0) continue;
    flat.push({ id: t.id, artist: cur(t, "artist"), title: cur(t, "title"), genre: g, score: cut, verdict: cut >= 60 ? "cut" : "review", reasons: reasons.slice(0, 3) });
  }
  flat.sort((a, b) => b.score - a.score);
  const counts = countBy(flat, (p) => p.genre);
  const byGenre = {};
  for (const p of flat) {
    const shelf = counts[p.genre] >= 10 && p.genre !== "(none)" ? p.genre : p.genre === "(none)" ? "No genre" : "Other genres";
    (byGenre[shelf] ||= []).push(p);
  }
  const topGenres = [...stats.genre.hit.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([g]) => g);
  return { flat, byGenre, taste: { playedTracks: played.length, bpmRange: [Math.round(bpmLo), Math.round(bpmHi)], topGenres } };
}

// Free preview: counts plus a sample. The full lists are only returned to paid users.
export function preview(result) {
  const byGenre = Object.entries(result.purge).map(([genre, items]) => ({
    genre, count: items.length, cut: items.filter((i) => i.verdict === "cut").length, sample: items.slice(0, 3),
  })).sort((a, b) => b.count - a.count);
  const bySev = [...result.fixes].sort((a, b) => (a.confidence === "high" ? 0 : 1) - (b.confidence === "high" ? 0 : 1));
  const seen = new Set(); const sample = [];
  const ruleKey = (f) => f.rule.replace(/\d+/g, "#");
  for (const f of bySev) { if (sample.length >= 12) break; if (seen.has(ruleKey(f))) continue; seen.add(ruleKey(f)); sample.push(f); }
  for (const f of bySev) { if (sample.length >= 12) break; if (!sample.includes(f)) sample.push(f); }
  const setsPreview = result.sets.map((s, i) => ({ name: s.name, minutes: s.minutes, count: s.tracks.length, keys: s.tracks.map((t) => t.key), bpms: s.tracks.map((t) => t.bpm), tracks: i === 0 ? s.tracks.slice(0, 3) : [] }));
  const gapsPreview = { totalReleases: result.gaps.totalReleases, releases: result.gaps.releases.slice(0, 3), artists: result.gaps.artists.slice(0, 5) };
  return { health: result.health, taste: result.taste, fixSample: sample, purgeByGenre: byGenre, setsPreview, gapsPreview };
}

// ---------- Sets: harmonic, BPM-smooth playlists built from the tracks you actually play
const MUSICAL_TO_CAMELOT = {
  "Abm": "1A", "G#m": "1A", "B": "1B", "Ebm": "2A", "D#m": "2A", "F#": "2B", "Gb": "2B", "Bbm": "3A", "A#m": "3A", "Db": "3B", "C#": "3B",
  "Fm": "4A", "Ab": "4B", "G#": "4B", "Cm": "5A", "Eb": "5B", "D#": "5B", "Gm": "6A", "Bb": "6B", "A#": "6B", "Dm": "7A", "F": "7B",
  "Am": "8A", "C": "8B", "Em": "9A", "G": "9B", "Bm": "10A", "D": "10B", "F#m": "11A", "Gbm": "11A", "A": "11B", "C#m": "12A", "Dbm": "12A", "E": "12B",
};
function camelot(t) {
  const m = /^\s*(\d{1,2}[AB])\b/i.exec(t.comments || "");
  if (m) return m[1].toUpperCase();
  const k = (t.key || "").trim();
  if (/^\d{1,2}[AB]$/i.test(k)) return k.toUpperCase();
  return MUSICAL_TO_CAMELOT[k] || null;
}
const energyOf = (t) => { const m = /Energy\s*(\d+)/i.exec(t.comments || ""); return m ? Number(m[1]) : null; };
function compatible(a, b) {
  if (!a || !b) return false;
  const na = parseInt(a), nb = parseInt(b), la = a.slice(-1), lb = b.slice(-1);
  if (na === nb) return true;
  return la === lb && ((na - nb + 12) % 12 === 1 || (nb - na + 12) % 12 === 1);
}

export function buildSets(tracks, taste) {
  const played = tracks.filter((t) => t.plays > 0);
  const genreCount = {};
  for (const t of played) if (t.genre) genreCount[t.genre] = (genreCount[t.genre] || 0) + 1;
  const genres = Object.entries(genreCount).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([g]) => g);
  const [lo, hi] = taste.bpmRange;
  const withEnergy = tracks.filter((t) => energyOf(t) != null).length / Math.max(1, tracks.length) > 0.5;
  const used = new Set();
  const sets = [];
  const arcs = { warm: [4, 4, 5, 5, 5, 6, 6, 6, 6, 7, 6, 6], peak: [5, 6, 6, 6, 7, 7, 7, 7, 8, 8, 8, 8, 7, 7, 6] };
  genres.forEach((g, gi) => {
    const kind = gi % 2 === 0 ? "peak" : "warm";
    const minutes = kind === "peak" ? 75 : 60;
    const arc = arcs[kind];
    const pool = tracks
      .filter((t) => t.genre === g && !used.has(t.id) && t.time > 150 && t.bpm >= lo - 3 && t.bpm <= hi + 3)
      .map((t) => ({ ...t, ck: camelot(t), en: energyOf(t) }))
      .filter((t) => t.ck && (!withEnergy || t.en != null))
      .sort((a, b) => (b.plays * 2 + (b.bitrate >= 256 ? 3 : 0)) - (a.plays * 2 + (a.bitrate >= 256 ? 3 : 0)))
      .slice(0, 500);
    if (pool.length < 6) return;
    const score = (p) => p.plays * 2 + (p.bitrate >= 256 ? 3 : 0);
    let best = null;
    const starts = pool.filter((p) => !withEnergy || Math.abs(p.en - arc[0]) <= 1).slice(0, 25);
    for (const start of starts) {
      const seq = [start], ids = new Set([start.id]); let tot = start.time;
      while (tot < minutes * 60) {
        const cur = seq[seq.length - 1], want = arc[Math.min(seq.length, arc.length - 1)];
        const cands = pool.filter((p) => !ids.has(p.id) && compatible(cur.ck, p.ck) && Math.abs(p.bpm - cur.bpm) <= 3 && p.bpm >= cur.bpm - 1.5 && (!withEnergy || Math.abs(p.en - want) <= 1) && primaryArtist(p.artist) !== primaryArtist(cur.artist));
        if (!cands.length) break;
        const nxt = cands.reduce((a, b) => (score(b) - (withEnergy ? 2 * Math.abs(b.en - want) : 0) - Math.abs(b.bpm - cur.bpm)) > (score(a) - (withEnergy ? 2 * Math.abs(a.en - want) : 0) - Math.abs(a.bpm - cur.bpm)) ? b : a);
        seq.push(nxt); ids.add(nxt.id); tot += nxt.time;
      }
      const q = [tot >= minutes * 60 * 0.85 ? 1 : 0, seq.reduce((a, p) => a + score(p), 0)];
      if (!best || q[0] > best.q[0] || (q[0] === best.q[0] && q[1] > best.q[1])) best = { q, seq, tot };
    }
    if (!best || best.seq.length < 6) return;
    best.seq.forEach((p) => used.add(p.id));
    sets.push({
      name: `${g} · ${kind === "peak" ? "Peak" : "Warm-up"} (${Math.round(best.tot / 60)}m)`,
      genre: g, minutes: Math.round(best.tot / 60),
      tracks: best.seq.map((p) => ({ id: p.id, artist: p.artist, title: p.title, key: p.ck, bpm: Math.round(p.bpm), energy: p.en })),
    });
  });
  return sets;
}

// ---------- Gaps: releases you own part of and play, plus artists to dig deeper into
export function findGaps(tracks) {
  const alb = new Map();
  for (const t of tracks) {
    if (!t.album) continue;
    const tn = parseInt(t.tn || "0"); // track number (optional field)
    const k = norm(t.album) + "|" + norm(primaryArtist(t.artist));
    if (!alb.has(k)) alb.set(k, { album: t.album, artist: primaryArtist(t.artist), nums: new Set(), plays: 0, owned: 0 });
    const a = alb.get(k); a.owned++; a.plays += t.plays || 0; if (tn > 0) a.nums.add(tn);
  }
  const releases = [];
  for (const a of alb.values()) {
    const nums = [...a.nums]; if (!nums.length) continue;
    const mx = Math.max(...nums);
    if (mx < 2 || mx > 12 || a.plays === 0) continue;
    const missing = []; for (let i = 1; i <= mx; i++) if (!a.nums.has(i)) missing.push(i);
    if (missing.length) releases.push({ album: a.album, artist: a.artist, owned: a.owned, of: mx, missing, plays: a.plays });
  }
  releases.sort((x, y) => y.plays - x.plays);
  const art = {};
  for (const t of tracks) if (t.plays > 0) for (const a of (t.artist || "").split(/\s*(?:,|&|\/|;| feat\.? | ft\.? )\s*/i)) if (a) art[a] = (art[a] || 0) + t.plays;
  const artists = Object.entries(art).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([name, plays]) => ({ name, plays }));
  return { releases: releases.slice(0, 200), totalReleases: releases.length, artists };
}
