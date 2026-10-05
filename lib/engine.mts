// BINDIG analysis engine v0.3 — runs server-side only.
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
const JUNK_TAIL = new RegExp(`\\s*[-\u2013|]\\s*(?:www\\.)?[\\w.-]+\\.${SITE_TLD}\\s*$`, "i");
// A trailing bare domain in a title/artist, e.g. "Track Name DeepDJ.org". Only when the name looks like a DJ/download site,
// so artist names with dots (Mr.Oizo) are left alone.
const JUNK_BARE = /\s+(?:www\.)?[\w-]*(?:dj|mp3|music|club|promo|download|house|techno|beat|track|zone|crate|fresh|exclusive|pool|remix)[\w-]*\.(?:[a-z]{2,6})(?:\.[a-z]{2})?\s*$/i;
const JUNK_URL = /[\s_]*(?:[\u00ab\u00bb\u00f8\u00ba*~]+\s*)*(?:https?:\/\/|www\.)\S+(?:\s*[\u00ab\u00bb\u00f8\u00ba*~]+)*|\s+[\w.-]+\.blogspot\.com\b/gi;
const JUNK_ANY = new RegExp(`(?:https?://\\S+|www\\.\\S+|\\b[\\w-]+\\.${SITE_TLD}\\b)`, "gi");

const norm = (s) => (s || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
const primaryArtist = (a) => (a || "").split(/\s*(?:,|&|\/|;| feat\.? | ft\.? | x | vs\.? )\s*/i)[0].trim();
const tidy = (s) => s.replace(/\s{2,}/g, " ").replace(/\s+([)\]])/g, "$1").replace(/[\s\-\u2013|]+$/g, "").trim();

function looksLikeJunkGenre(g) {
  return /\.(com|pl|info|club|net|org|biz|ru)\b/i.test(g) || /^(dj|mp3|music|club|www)/i.test(g) && /\./.test(g);
}

// Comments: remove only the download-site / store text, keep everything the DJ wrote.
// Protected: the Mixed In Key prefix ("8A - Energy 6") and Rekordbox My Tag blocks ("/* Deep House / Vocal */").
// Store receipts ("Purchased at Beatport.com", "Amazon.com Song ID: 123") are offered separately (optional).
const TLDS = "com|org|net|info|club|pl|ru|uk|co|lt|lv|me|to|cc|io|xyz|eu|biz|de|fr|nl|es|it|us|fm|dj|top|site|online|store|live|in|tv|ws|su|ua|by|mx|br|cz|sk|hu|ro|gr|tk|ml|cf|ga|gq|pro|nmet";
const URL_SRC = `<?(?:https?:\\/\\/|www\\.)[^\\s<>\\]]*>?|\\b[\\w-]+(?:\\.[\\w-]+)*\\.(?:${TLDS})(?:\\/[^\\s<>\\]]*)?\\b`;
const DOMAIN = new RegExp(URL_SRC, "i");
const CREDITS = "visit|downloaded from|download(?:ed)? (?:at|from)|free download(?: at| from)?|get (?:it|more(?: music)?) (?:at|on|from)|order this cd at|for promotional use only(?: by)?|distributed exclusively by|distributed by|release(?:d)? by \\S+ for|rlz by|ripped by|uploaded by|shared by|posted by|promo from|from|at|by";
const JUNK_RE = new RegExp(`(?:\\b(?:${CREDITS})\\s*:?\\s*)?(?:${URL_SRC})(?:\\s*(?:=+>|-+>|\u00bb)\\s*[^/|]*$)?`, "gi");
const STORE_RE = new RegExp(`\\b(?:purchased|bought) (?:at|from|on)\\s+(?:${URL_SRC}|\\w+)|\\bamazon\\.com song id:?\\s*\\d*|\\bdelivered by\\s+\\S+`, "gi");
const ENCODER = /^(?:fre:ac\b.*|to (?:mp3|audio|wav|aiff|flac) converter.*|.*\bconverter (?:free|lite|pro)\b.*|lame\s*\d.*|encoded (?:by|with)\b.*)$/i;
function tidyComment(s) {
  return s.replace(/\[url=[^\]]*\]([^\[]*)\[\/url\]/gi, "$1").replace(/<\s*>|\(\s*\)|\[\s*\]/g, " ")
    .replace(/\s*(?:\s[-\u2013|]\s*){2,}/g, " - ").replace(/\s{2,}/g, " ")
    .replace(/^[\s\-\u2013|:,;=>\u00bb*~]+|[\s\-\u2013|:,;=>\u00bb*~]+$/g, "").trim();
}
function cleanComments(c) {
  const src = c || "";
  if (!src.trim()) return { junk: false, withoutJunk: src, store: false, withoutStore: src };
  const m = /^\s*(\d{1,2}[AB](?:\/\d{1,2}[AB])?\s*-\s*Energy\s*\d+)\s*(?:-\s*)?([\s\S]*)$/i.exec(src);
  const prefix = m ? m[1].trim() : "";
  let rest = m ? m[2] : src;
  const tags = [];
  rest = rest.replace(/\/\*[\s\S]*?\*\//g, (x) => { tags.push(x.trim()); return " @@T" + (tags.length - 1) + "T@@ "; });
  const store = STORE_RE.test(rest); STORE_RE.lastIndex = 0;
  const finish = (txt) => {
    let out = tidyComment(txt.replace(/@@T\d+T@@/g, " "));
    if (ENCODER.test(out)) out = "";
    const parts = [prefix, out, ...tags].filter(Boolean);
    return parts.join(prefix && !out && tags.length ? " " : " ").replace(/^(\d{1,2}[AB][^ ]* - Energy \d+) (?!\/\*)/, "$1 - ").trim();
  };
  // remove junk, keep store receipts
  const keepStore = []; let noJunk = rest.replace(STORE_RE, (x) => { keepStore.push(x); return " @@S" + (keepStore.length - 1) + "S@@ "; });
  noJunk = noJunk.replace(JUNK_RE, " ").replace(/@@S(\d+)S@@/g, (_, i) => keepStore[+i]);
  const withoutJunk = finish(noJunk);
  const withoutStore = finish(rest.replace(STORE_RE, " ").replace(JUNK_RE, " "));
  const norm0 = (s) => s.replace(/\s+/g, " ").trim();
  return { junk: norm0(withoutJunk) !== norm0(src), withoutJunk, store, withoutStore };
}

export function analyse(tracks, opts = {}) {
  const prefs = { love: new Set((opts.prefs?.love || []).map(String)), skip: new Set((opts.prefs?.skip || []).map(String)) };
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

  // Pass 2b: the same genre written different ways ("Electro/Dance", "Electro; Dance"). Optional: most-used spelling wins.
  const gkey = (g) => g.toLowerCase().split(/\s*[\/;|,]\s*/).map((x) => x.trim()).filter(Boolean).join("/");
  const gforms = new Map();
  for (const t of tracks) { const g = cur(t, "genre"); if (!g) continue; const k = gkey(g); if (!gforms.has(k)) gforms.set(k, new Map()); const m = gforms.get(k); m.set(g, (m.get(g) || 0) + 1); }
  for (const t of tracks) {
    const g = cur(t, "genre"); if (!g) continue; const m = gforms.get(gkey(g)); if (!m || m.size < 2) continue;
    const [best, n] = [...m.entries()].sort((x, y) => y[1] - x[1])[0];
    if (best !== g && n >= 3) add(t, "genre", best, "Genre written the same way as your other tracks", "medium");
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
  const dupOf = new Map(), dupGroupsList = [];
  for (const g of dupGroups.values()) {
    if (g.length < 2) continue;
    dupGroupsList.push(g);
    const sorted = [...g].sort(keepOrder);
    for (const t of sorted.slice(1)) dupOf.set(t.id, sorted[0]);
  }
  const copy = (x) => ({ id: x.id, bitrate: x.bitrate || 0, plays: x.plays || 0, cues: x.cues || 0, lists: x.lists || 0, added: x.added || "", kind: x.kind || "" });
  // Two ways to choose the copy to keep: your prep first (cues, playlists, plays), or best audio quality first.
  const makeTidy = (order) => {
    const out = [];
    for (const g of dupGroupsList) {
      const sorted = [...g].sort(order), best = sorted[0];
      for (const t of sorted.slice(1)) {
        const both = (t.cues || 0) > 0 && (best.cues || 0) > 0;
        const reason = order === qualityOrder && quality(best) > quality(t) ? `The other copy is better quality (${lossless(best) ? "lossless" : (best.bitrate || "?") + " kbps"})`
          : both ? `Both copies have cue points (${best.cues} and ${t.cues}). Check before removing either`
          : (best.cues || 0) > (t.cues || 0) ? `The other copy has your cue points (${best.cues})`
          : (best.lists || 0) > (t.lists || 0) ? `The other copy is in ${best.lists} of your playlists`
          : best.plays > t.plays ? `You play the other copy (${best.plays} plays)`
          : quality(best) > quality(t) ? `The other copy is better quality (${best.bitrate} kbps)` : "Same track twice, same quality";
        out.push({ id: t.id, artist: cur(t, "artist"), title: cur(t, "title"), genre: cur(t, "genre") || "(none)", bitrate: t.bitrate, plays: t.plays,
          spare: copy(t), keep: copy(best), careful: both || (t.lists || 0) > 0, reason });
      }
    }
    return out;
  };
  const tidyUp = makeTidy(keepOrder), tidyQuality = makeTidy(qualityOrder);

  const S = librarySignals(tracks, prefs);
  const taste = tasteModel(tracks, cur, S, prefs);
  const gems = gemsModel(tracks, cur, dupOf, taste, S, prefs);
  const because = becauseYouPlay(tracks, cur, taste, gems, S);

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
    gemTypes: countBy(gems.flat, (g) => g.type),
    signals: S.public,
  };
  const issuesTracks = new Set([...fixedIds, ...dupOf.keys()]);
  health.score = Math.max(0, Math.round(100 * (1 - (issuesTracks.size + genreNeedsLookup * 0.5) / Math.max(1, tracks.length))));
  const gemMap = new Map(gems.flat.map((g) => [g.id, g]));
  for (const [id, sc] of gems.cands) if (!gemMap.has(id) && !dupOf.has(id)) gemMap.set(id, { id, score: sc, soft: true });
  const mixOut = buildMixes(tracks, taste.summary, gemMap, cur);
  const mixes = mixOut.mixes;
  const gaps = findGaps(tracks);
  const tags = tagIdeas(tracks, cur, gems, taste, S);
  health.mixes = mixes.length; health.gapReleases = gaps.totalReleases;
  health.mixGems = mixes.reduce((a, m) => a + m.gems, 0);
  health.mixNote = mixOut.note;
  health.tags = tags.length; health.tagged = new Set(tags.flatMap((x) => x.ids)).size;
  health.ready = {
    played: tracks.filter((t) => t.plays > 0).length,
    keys: tracks.filter((t) => camelot(t)).length,
    bpm: tracks.filter((t) => t.bpm > 0).length,
    genres: tracks.filter((t) => cur(t, "genre")).length,
    energy: tracks.filter((t) => energyOf(t) != null).length,
  };
  const out = { health, fixes, gems: gems.byGenre, gemsFlat: gems.flat, because, tidy: tidyUp, tidyQuality, taste: taste.summary, mixes, gaps, tags };
  if (opts.focus) out.focus = buildMixes(tracks, taste.summary, gemMap, cur, opts.focus);
  return out;
}

function countBy(arr, fn) { const m = {}; for (const x of arr) { const k = fn(x); m[k] = (m[k] || 0) + 1; } return m; }
const lossless = (t) => /wav|aiff|aif|flac|alac/i.test(t.kind || "");
const quality = (t) => (lossless(t) ? 2000 : 0) + (t.bitrate || 0);
const keepOrder = (a, b) => ((b.cues || 0) - (a.cues || 0)) || ((b.lists || 0) - (a.lists || 0)) || (b.plays - a.plays) || (quality(b) - quality(a)) || (b.time - a.time);
const qualityOrder = (a, b) => (quality(b) - quality(a)) || ((b.cues || 0) - (a.cues || 0)) || ((b.lists || 0) - (a.lists || 0)) || (b.plays - a.plays) || (b.time - a.time);
const STARS = (r) => (r >= 255 ? 5 : r >= 204 ? 4 : r >= 153 ? 3 : r >= 102 ? 2 : r >= 51 ? 1 : 0);

// Which signals can this library's data be trusted for? Results vary a lot between DJs:
// some play from USB (play counts never reach the collection), some rate or cue every track.
function librarySignals(tracks, prefs) {
  const n = Math.max(1, tracks.length);
  const played = tracks.filter((t) => t.plays > 0).length, rated = tracks.filter((t) => t.rating > 0).length, cued = tracks.filter((t) => t.cues > 0).length;
  const unplayed = tracks.filter((t) => !(t.plays > 0));
  const lists = tracks.map((t) => t.lists || 0).sort((a, b) => a - b);
  const S = {
    playCov: played / n, ratedShare: rated / n, cueShare: cued / n,
    prepped: unplayed.filter((t) => t.cues > 0 || t.rating > 0).length,
    listsP75: lists[Math.floor(0.75 * (lists.length - 1))] || 0,
    ratingLevels: new Set(tracks.filter((t) => t.rating > 0).map((t) => STARS(t.rating))).size,
  };
  S.bulkRated = S.ratedShare > 0.6;
  S.bulkCued = S.cueShare > 0.8;
  S.likeStars = S.bulkRated ? 4 : 1;
  S.historyThin = S.playCov < 0.35 && tracks.length >= 300;
  S.public = {
    playedPct: Math.round(100 * S.playCov), ratedPct: Math.round(100 * S.ratedShare), cuedPct: Math.round(100 * S.cueShare),
    historyThin: S.historyThin, bulkRated: S.bulkRated, bulkCued: S.bulkCued, likeStars: S.likeStars, prepped: S.prepped,
    loved: prefs.love.size, skipped: prefs.skip.size,
  };
  return S;
}

// How well do you already know this track? 0 = never touched, 1 = you know it. Bulk signals (every track rated or cued) count for little.
function familiarity(t, S) {
  let f = 0;
  if (t.plays === 1) f += 0.35;
  if (t.cues > 0) f += S.bulkCued ? 0.05 : 0.35;
  if (t.rating > 0) f += S.bulkRated ? 0.05 : 0.3;
  if ((t.lists || 0) > Math.max(1, S.listsP75)) f += 0.2;
  return Math.min(1, f);
}

// Taste model: learns from what you love. Liked = played, or rated at/above the library's "favourite" level
// (4★ when nearly every track is rated, any rating otherwise), or loved in BINDIG.
function tasteModel(tracks, cur, S, prefs) {
  const isLiked = (t) => t.plays > 0 || (t.rating > 0 && STARS(t.rating) >= S.likeStars) || prefs.love.has(String(t.id));
  const liked = tracks.filter(isLiked);
  const base = liked.length / Math.max(1, tracks.length);
  const feat = {
    genre: (t) => cur(t, "genre") || "(none)",
    artist: (t) => norm(primaryArtist(cur(t, "artist"))),
    label: (t) => norm(t.label) || null,
    bpm: (t) => (t.bpm ? Math.round(t.bpm / 4) * 4 : null),
  };
  const stats = {};
  for (const [f, fn] of Object.entries(feat)) {
    const all = new Map(), hit = new Map(), plays = new Map();
    for (const t of tracks) { const v = fn(t); if (v == null) continue; all.set(v, (all.get(v) || 0) + 1); if (isLiked(t)) { hit.set(v, (hit.get(v) || 0) + 1); plays.set(v, (plays.get(v) || 0) + (t.plays || 0)); } }
    stats[f] = { all, hit, plays };
  }
  const aff = (f, v) => { if (v == null) return base; const a = stats[f].all.get(v) || 0, h = stats[f].hit.get(v) || 0; return (h + 3 * base) / (a + 3); };
  const bpms = liked.map((t) => t.bpm).filter(Boolean).sort((a, b) => a - b);
  const q = (p) => bpms.length ? bpms[Math.floor(p * (bpms.length - 1))] : 0;
  const bpmLo = q(0.1), bpmHi = q(0.9);
  const topGenres = [...stats.genre.hit.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([g]) => g);
  return { base, feat, stats, aff, bpmLo, bpmHi, topGenres, isLiked, liked, summary: { playedTracks: liked.length, bpmRange: [Math.round(bpmLo), Math.round(bpmHi)], topGenres } };
}

// Gem types: why this track is waiting for you.
const GEM_TYPES = ["Played once", "Prepped, never played", "Deep cut", "New arrival", "Forgotten", "Still waiting"];

// Undiscovered gems: tracks you barely know that fit your taste and are good quality.
function gemsModel(tracks, cur, dupOf, T, S, prefs) {
  const weights = { genre: 0.35, artist: 0.3, label: 0.15, bpm: 0.2 };
  const now = Date.now();
  const flat = [], cands = new Map(), near = [], pool = new Map();
  for (const t of tracks) {
    const id = String(t.id), loved = prefs.love.has(id);
    if ((t.plays || 0) > 1 || dupOf.has(t.id) || prefs.skip.has(id)) continue;
    if (t.time && t.time < 120) continue;
    const fam = familiarity(t, S);
    if (fam >= 0.6 && !loved) continue;
    let fit = 0; for (const [f, w] of Object.entries(weights)) fit += w * T.aff(f, T.feat[f](t));
    const rel = fit / Math.max(0.01, T.base);
    let score = Math.max(0, Math.min(1, (rel - 0.8) / 1.2)) * 50;
    const reasons = [];
    const a = T.feat.artist(t), aPlays = T.stats.artist.plays.get(a) || 0, aHits = T.stats.artist.hit.get(a) || 0;
    if (aHits >= 2 && aPlays >= 5) { score += Math.min(14, 4 + aPlays / 6); reasons.push(`Artist you've played ${aPlays} times`); }
    else if (aHits >= 3) { score += 6; reasons.push(`Artist of ${aHits} of your favourites`); }
    const l = T.feat.label(t), lHits = l ? (T.stats.label.hit.get(l) || 0) : 0;
    if (lHits >= 3) { score += Math.min(10, 3 + lHits / 3); reasons.push(`Same label as ${lHits} tracks you love`); }
    const g = T.feat.genre(t);
    if (T.topGenres.includes(g)) { score += 5; reasons.push(`${g}, one of your core genres`); }
    if (t.bpm && T.bpmLo) {
      if (t.bpm >= T.bpmLo - 2 && t.bpm <= T.bpmHi + 2) { score += 6; reasons.push(`${Math.round(t.bpm)} BPM, right in your range`); }
      else score -= 12;
    }
    const stars = STARS(t.rating);
    if (stars >= 4 && !(t.plays > 0)) { score += 8; reasons.unshift(`You rated it ${stars}★ but never played it`); }
    else if (t.cues > 0 && !S.bulkCued && !(t.plays > 0)) { score += 6; reasons.unshift("You set cue points but never played it"); }
    if (lossless(t)) { score += 12; reasons.push("Lossless quality"); }
    else if (t.bitrate >= 320) { score += 10; reasons.push("320 kbps"); }
    else if (t.bitrate >= 256) score += 7;
    else if (t.bitrate && t.bitrate < 192) score -= 15;
    if (camelot(t)) score += 4;
    if (energyOf(t) != null) score += 3;
    if (t.time >= 240 && t.time <= 660) score += 4;
    const ageDays = t.added ? (now - Date.parse(t.added)) / 864e5 : 1800;
    if (ageDays < 365) { score += 4; reasons.push("Added this year"); }
    // When play history looks thin (e.g. you play from USB), older "unplayed" tracks are often ones you know.
    if (S.historyThin && ageDays > 730) score -= 6;
    score -= fam * 15;
    if (loved) { score += 25; reasons.unshift("You loved it in BINDIG"); }
    if ((t.plays || 0) === 1) reasons.push("Played just once");
    score = Math.max(0, Math.min(100, Math.round(score)));
    const prepped = !(t.plays > 0) && (t.cues > 0 || t.rating > 0);
    const type = (t.plays || 0) === 1 ? "Played once" : prepped ? "Prepped, never played" : (aHits >= 3 && aPlays >= 8) ? "Deep cut"
      : ageDays < 120 ? "New arrival" : ageDays > 365 ? "Forgotten" : "Still waiting";
    if (score >= 40) { cands.set(t.id, score); pool.set(t.id, { t, score }); }
    const item = { id: t.id, artist: cur(t, "artist"), title: cur(t, "title"), genre: g, score, type, key: camelot(t), bpm: Math.round(t.bpm || 0), reasons: [...new Set(reasons)].slice(0, 3), loved: loved || undefined };
    if (score >= 45 && reasons.length >= 1) near.push(item);
    if (!loved && (score < 55 || reasons.length < 2)) continue;
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
  return { flat, byGenre, cands, pool };
}

// "Because you play X": for your favourites, the closest tracks you barely know (artist, label, key, BPM, energy, era, genre).
function becauseYouPlay(tracks, cur, T, gems, S) {
  const favs = T.liked.filter((t) => camelot(t) && t.bpm > 0)
    .sort((a, b) => ((b.plays || 0) + STARS(b.rating) / 2) - ((a.plays || 0) + STARS(a.rating) / 2)).slice(0, 60);
  const cands = [...gems.pool.values()].filter((x) => camelot(x.t) && x.t.bpm > 0);
  const gemIds = new Set(gems.flat.map((g) => g.id));
  const used = new Set(), out = [];
  const yr = (t) => parseInt(t.year) || 0;
  for (const f of favs) {
    const fa = norm(primaryArtist(cur(f, "artist"))), fl = norm(f.label), fk = camelot(f), fe = energyOf(f), fg = cur(f, "genre");
    const scored = [];
    for (const c of cands) {
      const t = c.t; if (used.has(t.id) || t.id === f.id) continue;
      let s = 0; const why = [];
      if (fa && norm(primaryArtist(cur(t, "artist"))) === fa) { s += 3; why.push("same artist"); }
      if (fl && norm(t.label) === fl) { s += 2; why.push("same label"); }
      if (compatible(fk, camelot(t))) { s += 1.5; why.push(fk === camelot(t) ? `same key ${fk}` : "key-compatible"); }
      const d = Math.abs(t.bpm - f.bpm); if (d <= 2) { s += 1.5; why.push("same tempo"); } else if (d <= 4) s += 0.8; else s -= 1;
      if (fg && cur(t, "genre") === fg) s += 1;
      if (yr(f) && yr(t) && Math.abs(yr(f) - yr(t)) <= 2) s += 0.5;
      if (fe != null && energyOf(t) != null && Math.abs(fe - energyOf(t)) <= 1) { s += 0.5; why.push("same energy"); }
      s += c.score / 100 + (gemIds.has(t.id) ? 0.3 : 0);
      if (s >= 4.2 && why.length >= 2) scored.push({ t, s, why });
    }
    scored.sort((a, b) => b.s - a.s);
    const picks = scored.slice(0, 3);
    if (!picks.length) continue;
    picks.forEach((p) => used.add(p.t.id));
    out.push({ fav: { id: f.id, artist: cur(f, "artist"), title: cur(f, "title"), plays: f.plays || 0, key: camelot(f), bpm: Math.round(f.bpm) },
      picks: picks.map((p) => ({ id: p.t.id, artist: cur(p.t, "artist"), title: cur(p.t, "title"), key: camelot(p.t), bpm: Math.round(p.t.bpm), why: p.why.slice(0, 3).join(" · "), gem: gemIds.has(p.t.id) })) });
    if (out.length >= 30) break;
  }
  return out;
}

// Tag ideas: playlists the DJ can turn into My Tags in Rekordbox (select all → My Tag). Adds only; never touches existing tags.
// Rekordbox XML can't carry My Tags, so BINDIG delivers them as playlists under BINDIG → 4 · Tags.
function tagIdeas(tracks, cur, gems, T, S) {
  const y0 = new Date().getFullYear();
  const withEnergy = tracks.filter((t) => energyOf(t) != null).length / Math.max(1, tracks.length) > 0.5;
  const playedSorted = tracks.filter((t) => t.plays >= 3).sort((a, b) => b.plays - a.plays);
  const favIds = new Set(playedSorted.slice(0, Math.max(10, Math.round(playedSorted.length * 0.15))).map((t) => t.id));
  const gemIds = new Set(gems.flat.map((g) => g.id));
  const defs = [
    ["Role · Warm-up", "Mixed In Key energy 1–4", (t) => withEnergy && energyOf(t) != null && energyOf(t) <= 4],
    ["Role · Builder", "Mixed In Key energy 5–6", (t) => withEnergy && [5, 6].includes(energyOf(t))],
    ["Role · Peak", "Mixed In Key energy 7+", (t) => withEnergy && energyOf(t) >= 7],
    ["Vocal", "\"Vocal\" or \"Vox\" in the title", (t) => /\b(vocal|vox)\b/i.test(cur(t, "title")) && !/\b(instrumental|dub)\b/i.test(cur(t, "title"))],
    ["Dub", "\"Dub\" in the title", (t) => /\bdub\b/i.test(cur(t, "title"))],
    ["Instrumental", "\"Instrumental\" in the title", (t) => /\b(instrumental|inst)\b/i.test(cur(t, "title"))],
    ["Edit · Rework", "Edits, reworks and bootlegs", (t) => /\b(rework|re-?edit|edit|bootleg|flip)\b/i.test(cur(t, "title")) && !/\bradio edit\b/i.test(cur(t, "title"))],
    ["Era · New", `Released ${y0 - 1}–${y0}`, (t) => (parseInt(t.year) || 0) >= y0 - 1],
    ["Era · Classic", `Released ${y0 - 10} or earlier`, (t) => { const y = parseInt(t.year) || 0; return y > 1900 && y <= y0 - 10; }],
    ["Status · Favourite", "Your most-played tracks", (t) => favIds.has(t.id)],
    ["Status · Gem", "BINDIG's undiscovered gems", (t) => gemIds.has(t.id)],
    ["Status · Prepped, never played", "Cue points or rating, but 0 plays", (t) => !(t.plays > 0) && (t.cues > 0 || t.rating > 0)],
  ];
  const out = [];
  for (const [name, why, fn] of defs) {
    const ids = tracks.filter(fn).map((t) => t.id);
    if (ids.length >= 5) out.push({ name, why, ids });
  }
  return out;
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
  const becausePreview = (result.because || []).slice(0, 1).map((b) => ({ fav: b.fav, picks: b.picks.slice(0, 1) }));
  const tagsPreview = (result.tags || []).map((t) => ({ name: t.name, why: t.why, count: t.ids.length }));
  return { health: result.health, taste: result.taste, fixSample: sample, gemsByGenre, mixesPreview, gapsPreview, tidyCount: result.tidy.length, becausePreview, becauseCount: (result.because || []).length, tagsPreview };
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
export function buildMixes(tracks, taste, gemMap, cur = (t, f) => t[f] || "", focus = null) {
  const rng = mulberry32((focus && Number(focus.seed)) || 1);
  const played = tracks.filter((t) => t.plays > 0);
  const G = (t) => cur(t, "genre");
  const genreCount = {};
  for (const t of played) { const g = G(t); if (g) genreCount[g] = (genreCount[g] || 0) + 1; }
  const genres = Object.entries(genreCount).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([g]) => g);
  let [lo, hi] = taste.bpmRange, tol = 3;
  if (focus) { lo = Number(focus.bpmLo) || lo; hi = Number(focus.bpmHi) || hi; if (lo > hi) [lo, hi] = [hi, lo]; tol = 0.5; }
  const withEnergy = tracks.filter((t) => energyOf(t) != null).length / Math.max(1, tracks.length) > 0.5 && !(focus && focus.vibe === "any");
  const keyed = tracks.filter((t) => camelot(t)).length;
  const used = new Set();
  const mixes = [];
  const arcs = { warm: [4, 4, 5, 5, 5, 6, 6, 6, 6, 7, 6, 6, 6], peak: [5, 6, 6, 6, 7, 7, 7, 7, 8, 8, 8, 8, 7, 7, 6] };
  const decorate = (t) => ({ ...t, ck: camelot(t), en: energyOf(t), isNew: !(t.plays > 0) && gemMap.has(t.id), gs: gemMap.get(t.id)?.score || 0 });
  const eligible = (t) => !used.has(t.id) && t.time > 150 && t.bpm >= lo - tol && t.bpm <= hi + tol && (t.plays > 0 || gemMap.has(t.id));

  function build(pool, kind, minutes) {
    const arc = arcs[kind];
    const favs = pool.filter((p) => !p.isNew), gemsP = pool.filter((p) => p.isNew);
    if (favs.length < 5 || gemsP.length < 2) return null;
    const score = (p) => p.isNew ? p.gs / 6 : p.plays * 2 + (p.bitrate >= 256 ? 3 : 0);
    const wantNew = (i) => i % 3 === 2;
    let best = null;
    let starts = favs.filter((p) => !withEnergy || Math.abs(p.en - arc[0]) <= 1).sort((a, b) => score(b) - score(a));
    starts = focus ? starts.slice(0, 80).map((p) => [rng(), p]).sort((a, b) => a[0] - b[0]).map((x) => x[1]).slice(0, 25) : starts.slice(0, 25);
    for (const start of starts) {
      const seq = [start], ids = new Set([start.id]); let tot = start.time;
      while (tot < minutes * 60) {
        const last = seq[seq.length - 1], want = arc[Math.min(seq.length, arc.length - 1)];
        const ok = (p) => !ids.has(p.id) && compatible(last.ck, p.ck) && Math.abs(p.bpm - last.bpm) <= 3 && p.bpm >= last.bpm - 1.5 && (!withEnergy || Math.abs(p.en - want) <= 1) && primaryArtist(p.artist) !== primaryArtist(last.artist);
        const prefer = wantNew(seq.length) ? gemsP : favs, other = wantNew(seq.length) ? favs : gemsP;
        let c = prefer.filter(ok); if (!c.length) c = other.filter(ok);
        if (!c.length) break;
        const val = (p) => score(p) - (withEnergy ? 2 * Math.abs(p.en - want) : 0) - Math.abs(p.bpm - last.bpm) + (focus ? rng() * 3 : 0);
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

  if (focus) {
    const want = new Set((focus.genres || []).map(String));
    const kind = focus.vibe === "warm" ? "warm" : "peak";
    const minutes = Math.max(20, Math.min(180, Number(focus.minutes) || 60));
    const pool = tracks.filter((t) => (!want.size || want.has(G(t))) && eligible(t)).map(decorate).filter((t) => t.ck && (!withEnergy || t.en != null));
    const best = build(pool, kind, minutes);
    if (!best) return { mixes: [], note: "Not enough tracks match that focus. Widen the BPM range or add a genre." };
    const label = want.size ? [...want].slice(0, 2).join(" + ") + (want.size > 2 ? " +" + (want.size - 2) : "") : "All genres";
    push(best, `Gem Crate · Focus · ${label} · ${bpmRange(best)}${focus.vibe === "warm" ? " · Warm-up" : focus.vibe === "peak" ? " · Peak" : ""}`, label);
    return { mixes, note: "" };
  }
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

function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

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
