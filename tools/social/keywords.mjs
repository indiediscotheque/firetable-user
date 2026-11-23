// The words people search with, for each of the room's genres: hashtags
// (CamelCase, which screen readers read as words and every platform matches
// whatever the case) and the plain phrase captions lead with, since Instagram,
// TikTok, YouTube and Pinterest rank on the words in a caption as much as its
// tags. Never deployed (tools/).

// the room's 33 genres (discover/lib/genres), most specific tag first
export const GENRES = {
  "Nu-Disco": { phrase: "nu-disco", tags: ["NuDisco", "Disco", "DanceMusic"] },
  "Disco": { phrase: "disco", tags: ["Disco", "DiscoMusic", "DanceMusic"] },
  "Synthpop": { phrase: "synthpop", tags: ["Synthpop", "Electropop", "SynthMusic"] },
  "Synthwave": { phrase: "synthwave", tags: ["Synthwave", "Retrowave", "SynthMusic"] },
  "Electro": { phrase: "electro", tags: ["Electro", "ElectronicMusic", "DanceMusic"] },
  "Electronica": { phrase: "electronica", tags: ["Electronica", "ElectronicMusic"] },
  "Electronic": { phrase: "electronic", tags: ["ElectronicMusic", "Electronic"] },
  "Indie Dance": { phrase: "indie dance", tags: ["IndieDance", "AltDance", "DanceMusic"] },
  "French House": { phrase: "French house", tags: ["FrenchHouse", "FrenchTouch", "HouseMusic"] },
  "House": { phrase: "house", tags: ["HouseMusic", "House", "DanceMusic"] },
  "Deep House": { phrase: "deep house", tags: ["DeepHouse", "HouseMusic"] },
  "Tech House": { phrase: "tech house", tags: ["TechHouse", "HouseMusic"] },
  "Techno": { phrase: "techno", tags: ["Techno", "ElectronicMusic"] },
  "UK Garage": { phrase: "UK garage", tags: ["UKGarage", "UKG"] },
  "Breaks & Bass": { phrase: "breaks", tags: ["Breakbeat", "BassMusic"] },
  "EDM": { phrase: "dance", tags: ["EDM", "DanceMusic"] },
  "Indie Pop": { phrase: "indie pop", tags: ["IndiePop", "IndieMusic"] },
  "Indie Rock": { phrase: "indie rock", tags: ["IndieRock", "IndieMusic"] },
  "Indie": { phrase: "indie", tags: ["IndieMusic", "Indie"] },
  "Dream Pop": { phrase: "dream pop", tags: ["DreamPop", "IndieMusic"] },
  "Chillwave": { phrase: "chillwave", tags: ["Chillwave", "DreamPop"] },
  "Downtempo": { phrase: "downtempo", tags: ["Downtempo", "Chillout"] },
  "Ambient": { phrase: "ambient", tags: ["AmbientMusic", "Ambient"] },
  "New Wave": { phrase: "new wave", tags: ["NewWave", "80sMusic"] },
  "Post-Punk & Darkwave": { phrase: "post-punk", tags: ["PostPunk", "Darkwave", "Coldwave"] },
  "Psych": { phrase: "psych", tags: ["Psychedelic", "PsychRock"] },
  "Funk": { phrase: "funk", tags: ["Funk", "FunkMusic"] },
  "Future Funk": { phrase: "future funk", tags: ["FutureFunk", "CityPop"] },
  "Soul & R&B": { phrase: "soul", tags: ["Soul", "RnB"] },
  "Hip Hop": { phrase: "hip-hop", tags: ["HipHop"] },
  "Pop": { phrase: "pop", tags: ["PopMusic", "NewPop"] },
  "Rock": { phrase: "rock", tags: ["RockMusic"] },
  "Jazz & Swing": { phrase: "jazz", tags: ["Jazz", "JazzMusic"] }
};

// Apple's genres, for songs the room hasn't tagged yet
const APPLE = {
  "Dance": "EDM", "Electronic": "Electronic", "House": "House", "Techno": "Techno", "Disco": "Disco", "Pop": "Pop", "Alternative": "Indie",
  "Indie Pop": "Indie Pop", "Indie Rock": "Indie Rock", "Rock": "Rock", "R&B/Soul": "Soul & R&B", "Hip-Hop/Rap": "Hip Hop", "Jazz": "Jazz & Swing",
  "Ambient": "Ambient", "Downtempo": "Downtempo", "Funk": "Funk", "New Wave": "New Wave", "Synth-Pop": "Synthpop", "Electronica": "Electronica"
};

/** The room's genre name for a song: its own tag, else Apple's mapped onto the room's. */
export function roomGenre(...candidates) {
  for (const g of candidates.flat()) {
    if (!g) continue;
    if (GENRES[g]) return g;
    if (APPLE[g]) return APPLE[g];
    const k = Object.keys(GENRES).find((x) => x.toLowerCase() === String(g).toLowerCase());
    if (k) return k;
  }
  return null;
}

export const phrase = (genre) => (GENRES[genre] && GENRES[genre].phrase) || "";

/**
 * Hashtags for a post, most telling first, since each platform keeps only the
 * first few: what it is (NewMusic, MusicChart), the genres' own tags, then
 * the rest of each, then the room's.
 */
export function tagsFor(kindTags, genres, room = ["IndieDiscotheque"]) {
  const g = genres.filter((x) => x && GENRES[x]).map((x) => GENRES[x].tags);
  const out = [kindTags[0], ...g.map((t) => t[0]), ...kindTags.slice(1), ...g.flatMap((t) => t.slice(1)), ...room].filter(Boolean);
  const seen = new Set();
  return out.filter((t) => { const k = t.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
}

/** The one tag that says most about a post (Threads takes a single topic). */
export const topicOf = (genres, fallback) => {
  const g = genres.find((x) => GENRES[x]);
  return g ? GENRES[g].tags[0] : fallback;
};
