// BINDIG analysis engine v0.2 — runs server-side only.
// Input: slim track list from a Rekordbox XML. Output: tag fixes, undiscovered gems, mixes, tidy-up, gaps, health summary.
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
  // keep separators so the user's own punctuation survives when we drop a junk segment
  const tok = rest.split(/(\s*\|\|\s*|\s+-\s+|\s*,\s+|\s+\|\s+)/);
  const segs = []; for (let i = 0; i < tok.length; i += 2) segs.push({ text: tok[i].trim(), sep: i > 0 ? tok[i - 1] : "" });
  const hasDomainElsewhere = (i) => segs.some((o, j) => j !== i && DOMAIN.test(o.text) && !STORE.test(o.text));
  let junk = false, store = false;
  segs.forEach((sg, i) => {
    if (!sg.text) { sg.kind = "empty"; return; }
    if (STORE.test(sg.text)) { sg.kind = "store"; store = true; return; }
    if (DOMAIN.test(sg.text) || /^downloaded from\b/i.test(sg.text) || /^rlz by\b/i.test(sg.text) || (CREDIT.test(sg.text) && hasDomainElsewhere(i))) { sg.kind = "junk"; junk = true; return; }
    sg.kind = "keep";
  });
  const build = (keepStore) => {
    let out = "";
    for (const sg of segs) {
      if (sg.kind === "keep" || (keepStore && sg.kind === "store")) out += (out ? (sg.sep || " - ") : "") + sg.text;
    }
    return [prefix, out].filter(Boolean).join(" - ").trim();
  };
  const withoutJunk = build(true);
  return { junk: junk && withoutJunk !== c.trim(), withoutJunk, store, withoutStore: build(false) };
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
    const album = t.album || "";
    if (album) {
      const onlySite = new RegExp(`^\\s*(?:https?://)?(?:www\\.)?[\\w.-]+\\.(?:[a-z]{2,6})(?:\\.[a-z]{2})?/?\\s*$`, "i").test(album) && !/\s/.test(album.trim()) && DOMAIN.test(album);
      if (onlySite) add(t, "album", "", "Website name removed from the album", "high");
      else {
        const strippedAlbum = album.replace(JUNK_URL, "").replace(JUNK_BRACKET, "").replace(JUNK_TAIL, "");
        const cleanedAlbum = tidy(strippedAlbum);
        if (strippedAlbum !== album && cleanedAlbum) add(t, "album", cleanedAlbum, "Download-site text removed from the album", "high");
      }
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
    // Skip samples/loops and tracks with no artist: short generic titles ("HORN") are not real duplicates.
    const ar = norm(primaryArtist(cur(t, "artist")));
    if (!ar || (t.time && t.time < 90)) continue;
    const k = ar + "|" + norm(cur(t, "title").replace(/\((original|extended) mix\)/i, ""));
    if (k.length < 4) continue;
    if (!dupGroups.has(k)) dupGroups.set(k, []);
    dupGroups.get(k).push(t);
  }
  const dupOf = new Map();
  for (const g of dupGroups.values()) {
    if (g.length < 2) continue;
    const sorted = [...g].sort((a, b) => ((b.cues || 0) - (a.cues || 0)) || ((b.lists || 0) - (a.lists || 0)) || (b.plays - a.plays) || (b.bitrate - a.bitrate) || (b.time - a.time));
    for (const t of sorted.slice(1)) dupOf.set(t.id, sorted[0]);
  }

  const taste = tasteModel(tracks, cur);
  const gems = gemsModel(tracks, cur, dupOf, taste);
  const byId = new Map(tracks.map((x) => [x.id, x]));
  const copy = (x) => ({ id: x.id, bitrate: x.bitrate || 0, plays: x.plays || 0, cues: x.cues || 0, lists: x.lists || 0, added: x.added || "", kind: x.kind || "" });
  const tidyUp = [...dupOf.entries()].map(([id, best]) => {
    const t = byId.get(id);
    const both = (t.cues || 0) > 0 && (best.cues || 0) > 0;
    const reason = both ? `Both copies have cue points (${best.cues} and ${t.cues}). Check before removing either`
      : (best.cues || 0) > (t.cues || 0) ? `The other copy has your cue points (${best.cues})`
      : (best.lists || 0) > (t.lists || 0) ? `The other copy is in ${best.lists} of your playlists`
      : best.plays > t.plays ? `You play the other copy (${best.plays} plays)`
      : (best.bitrate || 0) > (t.bitrate || 0) ? `The other copy is better quality (${best.bitrate} kbps)` : "Same track twice, same quality";
    return { id, artist: cur(t, "artist"), title: cur(t, "title"), genre: cur(t, "genre") || "(none)", bitrate: t.bitrate, plays: t.plays,
      spare: copy(t), keep: copy(best), careful: both || (t.lists || 0) > 0, reason };
  });

  const fixedIds = new Set(fixes.map((f) => f.id));
  const health = {
    tracks: tracks.length,
    played: tracks.filter((t) => t.plays > 0).length,
    unplayed: tracks.filter((t) => !(t.plays > 0)).length,
    fixable: fixedIds.size,
    fixes: fixes.length,
    byRule: countBy(fixes, (f) => f.rule
      .replace(/^Genre of \d+ of your \d+ other tracks by this artist$/, "Blank genre filled from the artist's other tracks")
      .replace(/^Matches the spelling on \d+ of your \d+ tracks by this artist$/, "Artist spelling matched to the rest of your library")),
    genreNeedsLookup, yearMissing, labelMissing,
    duplicates: dupOf.size,
    gems: gems.flat.length,
  };
  const issuesTracks = new Set([...fixedIds, ...dupOf.keys()]);
  health.score = Math.max(0, Math.round(100 * (1 - (issuesTracks.size + genreNeedsLookup * 0.5) / Math.max(1, tracks.length))));
  const gemMap = new Map(gems.flat.map((g) => [g.id, g]));
  for (const [id, sc] of gems.cands) if (!gemMap.has(id) && !dupOf.has(id)) gemMap.set(id, { id, score: sc, soft: true });
  const mixOut = buildMixes(tracks, taste.summary, gemMap, cur);
  const mixes = mixOut.mixes;
  const gaps = findGaps(tracks);
  health.mixes = mixes.length; health.gapReleases = gaps.totalReleases;
  health.mixGems = mixes.reduce((a, m) => a + m.gems, 0);
  health.mixNote = mixOut.note;
  health.ready = {
    played: tracks.filter((t) => t.plays > 0).length,
    keys: tracks.filter((t) => camelot(t)).length,
    bpm: tracks.filter((t) => t.bpm > 0).length,
    genres: tracks.filter((t) => cur(t, "genre")).length,
    energy: tracks.filter((t) => energyOf(t) != null).length,
  };
  return { health, fixes, gems: gems.byGenre, gemsFlat: gems.flat, tidy: tidyUp, taste: taste.summary, mixes, gaps };
}

function countBy(arr, fn) { const m = {}; for (const x of arr) { const k = fn(x); m[k] = (m[k] || 0) + 1; } return m; }

// Taste model: learns from what you play (plays > 0 or rated).
function tasteModel(tracks, cur) {
  const isPlayed = (t) => t.plays > 0 || t.rating > 0;
  const played = tracks.filter(isPlayed);
  const base = played.length / Math.max(1, tracks.length);
  const feat = {
    genre: (t) => cur(t, "genre") || "(none)",
    artist: (t) => norm(primaryArtist(cur(t, "artist"))),
    label: (t) => norm(t.label) || null,
    bpm: (t) => (t.bpm ? Math.round(t.bpm / 4) * 4 : null),
  };
  const stats = {};
  for (const [f, fn] of Object.entries(feat)) {
    const all = new Map(), hit = new Map(), plays = new Map();
    for (const t of tracks) { const v = fn(t); if (v == null) continue; all.set(v, (all.get(v) || 0) + 1); if (isPlayed(t)) { hit.set(v, (hit.get(v) || 0) + 1); plays.set(v, (plays.get(v) || 0) + (t.plays || 0)); } }
    stats[f] = { all, hit, plays };
  }
  const aff = (f, v) => { if (v == null) return base; const a = stats[f].all.get(v) || 0, h = stats[f].hit.get(v) || 0; return (h + 3 * base) / (a + 3); };
  const bpms = played.map((t) => t.bpm).filter(Boolean).sort((a, b) => a - b);
  const q = (p) => bpms.length ? bpms[Math.floor(p * (bpms.length - 1))] : 0;
  const bpmLo = q(0.1), bpmHi = q(0.9);
  const topGenres = [...stats.genre.hit.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([g]) => g);
  return { base, feat, stats, aff, bpmLo, bpmHi, topGenres, summary: { playedTracks: played.length, bpmRange: [Math.round(bpmLo), Math.round(bpmHi)], topGenres } };
}

// Undiscovered gems: tracks you have (almost) never played that fit your taste and are good quality.
function gemsModel(tracks, cur, dupOf, T) {
  const weights = { genre: 0.35, artist: 0.3, label: 0.15, bpm: 0.2 };
  const now = Date.now();
  const flat = [], cands = new Map(), near = [];
  for (const t of tracks) {
    if ((t.plays || 0) > 1 || t.rating > 0 || dupOf.has(t.id)) continue;
    if (t.time && t.time < 120) continue;
    let fit = 0; for (const [f, w] of Object.entries(weights)) fit += w * T.aff(f, T.feat[f](t));
    const rel = fit / Math.max(0.01, T.base);
    let score = Math.max(0, Math.min(1, (rel - 0.8) / 1.2)) * 50;
    const reasons = [];
    const a = T.feat.artist(t), aPlays = T.stats.artist.plays.get(a) || 0, aHits = T.stats.artist.hit.get(a) || 0;
    if (aHits >= 2 && aPlays >= 5) { score += Math.min(14, 4 + aPlays / 6); reasons.push(`Artist you've played ${aPlays} times`); }
    const l = T.feat.label(t), lHits = l ? (T.stats.label.hit.get(l) || 0) : 0;
    if (lHits >= 3) { score += Math.min(10, 3 + lHits / 3); reasons.push(`Same label as ${lHits} tracks you play`); }
    const g = T.feat.genre(t);
    if (T.topGenres.includes(g)) { score += 5; reasons.push(`${g}, one of your core genres`); }
    if (t.bpm && T.bpmLo) {
      if (t.bpm >= T.bpmLo - 2 && t.bpm <= T.bpmHi + 2) { score += 6; reasons.push(`${Math.round(t.bpm)} BPM, right in your range`); }
      else score -= 12;
    }
    const lossless = /wav|aiff|aif|flac|alac/i.test(t.kind || "");
    if (lossless) { score += 12; reasons.push("Lossless quality"); }
    else if (t.bitrate >= 320) { score += 10; reasons.push("320 kbps"); }
    else if (t.bitrate >= 256) score += 7;
    else if (t.bitrate && t.bitrate < 192) score -= 15;
    if (camelot(t)) score += 4;
    if (energyOf(t) != null) score += 3;
    if (t.time >= 240 && t.time <= 660) score += 4;
    const ageYears = t.added ? (now - Date.parse(t.added)) / 3.15e10 : 5;
    if (ageYears < 1) { score += 4; reasons.push("Added this year"); }
    if ((t.plays || 0) === 1) reasons.push("Played just once");
    score = Math.max(0, Math.min(100, Math.round(score)));
    if (score >= 40) cands.set(t.id, score);
    const item = { id: t.id, artist: cur(t, "artist"), title: cur(t, "title"), genre: g, score, key: camelot(t), bpm: Math.round(t.bpm || 0), reasons: reasons.slice(0, 3) };
    if (score >= 45 && reasons.length >= 1) near.push(item);
    if (score < 55 || reasons.length < 2) continue;
    flat.push(item);
  }
  // Smaller or loosely tagged libraries give fewer signals: top up with the next-best fits, up to ~8% of unplayed tracks.
  const unplayed = tracks.filter((t) => !(t.plays > 0)).length;
  if (flat.length < unplayed * 0.05) {
    const have = new Set(flat.map((x) => x.id));
    for (const x of near.sort((a, b) => b.score - a.score)) { if (flat.length >= Math.round(unplayed * 0.08)) break; if (!have.has(x.id)) flat.push(x); }
  }
  flat.sort((a, b) => b.score - a.score);
  const counts = countBy(flat, (p) => p.genre);
  const byGenre = {};
  for (const p of flat) {
    const minShelf = flat.length < 120 ? 3 : 8;
    const shelf = p.genre === "(none)" ? "No genre" : counts[p.genre] >= minShelf ? p.genre : "Other genres";
    (byGenre[shelf] ||= []).push(p);
  }
  return { flat, byGenre, cands };
}

// Free preview: counts plus a sample. The full lists are only returned to paid users.
export function preview(result) {
  const gemsByGenre = Object.entries(result.gems).map(([genre, items]) => ({ genre, count: items.length, sample: items.slice(0, 2) }))
    .sort((a, b) => b.count - a.count);
  const bySev = [...result.fixes].sort((a, b) => (a.confidence === "high" ? 0 : 1) - (b.confidence === "high" ? 0 : 1));
  const seen = new Set(); const sample = [];
  const ruleKey = (f) => f.rule.replace(/\d+/g, "#");
  for (const f of bySev) { if (sample.length >= 12) break; if (seen.has(ruleKey(f))) continue; seen.add(ruleKey(f)); sample.push(f); }
  for (const f of bySev) { if (sample.length >= 12) break; if (!sample.includes(f)) sample.push(f); }
  const mixesPreview = result.mixes.map((m, i) => ({ name: m.name, minutes: m.minutes, count: m.tracks.length, gems: m.gems, keys: m.tracks.map((t) => t.key), news: m.tracks.map((t) => !!t.isNew), tracks: i === 0 ? m.tracks.slice(0, 3) : [] }));
  const gapsPreview = { totalReleases: result.gaps.totalReleases, releases: result.gaps.releases.slice(0, 3), artists: result.gaps.artists.slice(0, 5) };
  return { health: result.health, taste: result.taste, fixSample: sample, gemsByGenre, mixesPreview, gapsPreview, tidyCount: result.tidy.length };
}

// ---------- Key helpers
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

// Gem Crates: your favourites plus undiscovered gems (about 1 in 3), key-compatible and close in BPM, sorted for easy auditioning.
// Energy shaping (warm-up/peak) only when Mixed In Key energy is present. BINDIG digs; the DJ does the mixing.
// First one mix per core genre; if the library is small or genres are sparse, fall back to cross-genre mixes by BPM.
export function buildMixes(tracks, taste, gemMap, cur = (t, f) => t[f] || "") {
  const played = tracks.filter((t) => t.plays > 0);
  const G = (t) => cur(t, "genre");
  const genreCount = {};
  for (const t of played) { const g = G(t); if (g) genreCount[g] = (genreCount[g] || 0) + 1; }
  const genres = Object.entries(genreCount).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([g]) => g);
  const [lo, hi] = taste.bpmRange;
  const withEnergy = tracks.filter((t) => energyOf(t) != null).length / Math.max(1, tracks.length) > 0.5;
  const keyed = tracks.filter((t) => camelot(t)).length;
  const used = new Set();
  const mixes = [];
  const arcs = { warm: [4, 4, 5, 5, 5, 6, 6, 6, 6, 7, 6, 6, 6], peak: [5, 6, 6, 6, 7, 7, 7, 7, 8, 8, 8, 8, 7, 7, 6] };
  const decorate = (t) => ({ ...t, ck: camelot(t), en: energyOf(t), isNew: !(t.plays > 0) && gemMap.has(t.id), gs: gemMap.get(t.id)?.score || 0 });
  const eligible = (t) => !used.has(t.id) && t.time > 150 && t.bpm >= lo - 3 && t.bpm <= hi + 3 && (t.plays > 0 || gemMap.has(t.id));

  function build(pool, kind, minutes) {
    const arc = arcs[kind];
    const favs = pool.filter((p) => !p.isNew), gemsP = pool.filter((p) => p.isNew);
    if (favs.length < 5 || gemsP.length < 2) return null;
    const score = (p) => p.isNew ? p.gs / 6 : p.plays * 2 + (p.bitrate >= 256 ? 3 : 0);
    const wantNew = (i) => i % 3 === 2;
    let best = null;
    const starts = favs.filter((p) => !withEnergy || Math.abs(p.en - arc[0]) <= 1).sort((a, b) => score(b) - score(a)).slice(0, 25);
    for (const start of starts) {
      const seq = [start], ids = new Set([start.id]); let tot = start.time;
      while (tot < minutes * 60) {
        const last = seq[seq.length - 1], want = arc[Math.min(seq.length, arc.length - 1)];
        const ok = (p) => !ids.has(p.id) && compatible(last.ck, p.ck) && Math.abs(p.bpm - last.bpm) <= 3 && p.bpm >= last.bpm - 1.5 && (!withEnergy || Math.abs(p.en - want) <= 1) && primaryArtist(p.artist) !== primaryArtist(last.artist);
        const prefer = wantNew(seq.length) ? gemsP : favs, other = wantNew(seq.length) ? favs : gemsP;
        let c = prefer.filter(ok); if (!c.length) c = other.filter(ok);
        if (!c.length) break;
        const val = (p) => score(p) - (withEnergy ? 2 * Math.abs(p.en - want) : 0) - Math.abs(p.bpm - last.bpm);
        const nxt = c.reduce((x, y) => (val(y) > val(x) ? y : x));
        seq.push(nxt); ids.add(nxt.id); tot += nxt.time;
      }
      const nNew = seq.filter((p) => p.isNew).length;
      const q = [tot >= minutes * 60 * 0.85 ? 1 : 0, Math.min(nNew, Math.floor(seq.length / 3)), seq.reduce((x, p) => x + score(p), 0)];
      if (!best || q[0] > best.q[0] || (q[0] === best.q[0] && (q[1] > best.q[1] || (q[1] === best.q[1] && q[2] > best.q[2])))) best = { q, seq, tot };
    }
    if (!best || best.seq.length < 6 || !best.seq.some((p) => p.isNew)) return null;
    best.seq.forEach((p) => used.add(p.id));
    return best;
  }
  const bpmRange = (best) => { const b = best.seq.map((p) => Math.round(p.bpm)).sort((x, y) => x - y); return b[0] === b[b.length - 1] ? `${b[0]} BPM` : `${b[0]}–${b[b.length - 1]} BPM`; };
  const arcName = (kind) => (withEnergy ? ` · ${kind === "peak" ? "Peak" : "Warm-up"}` : "");
  const push = (best, name, genre) => mixes.push({
    name, genre, minutes: Math.round(best.tot / 60), gems: best.seq.filter((p) => p.isNew).length,
    tracks: best.seq.map((p) => ({ id: p.id, artist: cur(p, "artist"), title: cur(p, "title"), key: p.ck, bpm: Math.round(p.bpm), energy: p.en, isNew: p.isNew, plays: p.plays || 0 })),
  });

  genres.forEach((g, gi) => {
    const kind = gi % 2 === 0 ? "peak" : "warm";
    const pool = tracks.filter((t) => G(t) === g && eligible(t)).map(decorate).filter((t) => t.ck && (!withEnergy || t.en != null));
    const best = build(pool, kind, kind === "peak" ? 75 : 60);
    if (best) push(best, `Gem Crate · ${g} · ${bpmRange(best)}${arcName(kind)}`, g);
  });
  // Fallback: cross-genre mixes around your BPM range, for smaller or loosely tagged libraries
  for (const kind of ["peak", "warm"]) {
    if (mixes.length >= 3) break;
    const pool = tracks.filter(eligible).map(decorate).filter((t) => t.ck && (!withEnergy || t.en != null));
    const best = build(pool, kind, kind === "peak" ? 60 : 50);
    if (!best) break;
    push(best, `Gem Crate · Mixed genres · ${bpmRange(best)}${arcName(kind)}`, "Mixed genres");
  }
  let note = "";
  if (!mixes.length) {
    note = keyed < tracks.length * 0.5 ? "Most tracks have no key yet. Analyse them in Rekordbox (or Mixed In Key), export again and rescan."
      : played.length < 20 ? "Not enough played tracks yet to learn your favourites. Play a few more sets, export again and rescan."
      : "We couldn't find enough tracks that sit with your favourites in key and BPM to fill a Gem Crate.";
  }
  return { mixes, note };
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
