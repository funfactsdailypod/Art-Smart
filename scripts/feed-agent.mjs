#!/usr/bin/env node
/**
 * Art Smart & Who ARTed Automated Feed Scanner + Trivia Builder
 * Scans both Megaphone RSS feeds + Apple Podcasts lookup, prioritizes short
 * episodes, classifies them into educator categories + Fun Facts (~25%),
 * extracts verified audio cueSeconds + ~8% deeper bonusQuestion follow-ups
 * via Gemini Flash when GEMINI_API_KEY is set, and falls back to clean show-note
 * extraction otherwise.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const QUESTIONS_PATH = path.join(ROOT, 'public', 'data', 'questions.json');

const FEEDS = [
  {
    show: 'Art Smart',
    rssUrl: 'https://feeds.megaphone.fm/ARML6383971331',
    appleId: '1603422346',
    appleFallback: 'https://podcasts.apple.com/us/podcast/art-smart/id1603422346',
    spotifyUrl: 'https://open.spotify.com/show/1S9SbkmRXtChPHxmlKfeZb',
    artworkFallback: 'images/art-smart-cover.png',
    omitEarliestCount: 0
  },
  {
    show: 'Who ARTed',
    rssUrl: 'https://feeds.megaphone.fm/ARML1644080429',
    appleId: '1485813093',
    appleFallback: 'https://podcasts.apple.com/us/podcast/who-arted-weekly-art-history-for-all-ages/id1485813093',
    spotifyUrl: 'https://open.spotify.com/show/1Sv71dnatL79dprwfX4Ypa',
    artworkFallback: 'images/who-arted-cover.png',
    // Omit the earliest 17 Season 1 / early episodes from Who ARTed
    omitEarliestCount: 17
  }
];

const CATEGORIES = [
  'Elements of Art',
  'Principles of Design',
  'Materials & Media',
  'Historical & Cultural Connections',
  'Fun Facts'
];

function decodeXmlEntities(str = '') {
  return str
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseDurationSec(raw = '') {
  const s = String(raw).trim();
  if (!s) return 480;
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  const parts = s.split(':').map((n) => parseInt(n, 10) || 0);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 480;
}

function extractTag(block, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const m = block.match(re);
  return m ? decodeXmlEntities(m[1]) : '';
}

function extractAttr(block, tag, attr) {
  const re = new RegExp(`<${tag}[^>]*\\b${attr}=["']([^"']+)["']`, 'i');
  const m = block.match(re);
  return m ? m[1].trim() : '';
}

async function fetchAppleMap(feed) {
  const byGuid = new Map();
  const byTitle = new Map();
  try {
    const res = await fetch(
      `https://itunes.apple.com/lookup?id=${feed.appleId}&media=podcast&entity=podcastEpisode&limit=200`
    );
    if (!res.ok) return { byGuid, byTitle };
    const data = await res.json();
    for (const item of data.results || []) {
      if (item.wrapperType !== 'podcastEpisode') continue;
      if (item.episodeGuid && item.trackViewUrl) byGuid.set(item.episodeGuid, item.trackViewUrl);
      if (item.trackName && item.trackViewUrl) byTitle.set(item.trackName.toLowerCase(), item.trackViewUrl);
    }
  } catch (err) {
    console.warn(`Apple lookup warning (${feed.show}):`, err.message);
  }
  return { byGuid, byTitle };
}

function parseFeedEpisodesXml(xml, feed, appleMaps = { byGuid: new Map(), byTitle: new Map() }) {
  const rawItems = [];
  const matches = xml.matchAll(/<item>([\s\S]*?)<\/item>/gi);
  for (const match of matches) {
    const block = match[1];
    const guid = extractTag(block, 'guid');
    const title = extractTag(block, 'title');
    if (!guid || !title) continue;
    // Permanently exclude retired episodes (e.g., Rosie the Riveter)
    if (guid === '75f4f398-9a4b-11ef-b714-3f6785155ee5' || /\brosie the riveter\b/i.test(title)) continue;

    if (/trailer|teaser|preview|bonus feed|announcement|\(encore\)|\bencore\b/i.test(title)) continue;

    const pubRaw = extractTag(block, 'pubDate');
    const pubMs = pubRaw ? Date.parse(pubRaw) : Date.now();
    const pubDate = Number.isFinite(pubMs) ? new Date(pubMs).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
    const audioUrl = extractAttr(block, 'enclosure', 'url');
    if (!audioUrl) continue;
    const durationSec = parseDurationSec(extractTag(block, 'itunes:duration'));
    const description = extractTag(block, 'itunes:summary') || extractTag(block, 'description');
    const artworkUrl = extractAttr(block, 'itunes:image', 'href') || feed.artworkFallback;
    const appleUrl =
      appleMaps.byGuid.get(guid) || appleMaps.byTitle.get(title.toLowerCase()) || feed.appleFallback;

    rawItems.push({
      guid,
      show: feed.show,
      title,
      pubDate,
      pubMs: Number.isFinite(pubMs) ? pubMs : 0,
      durationSec,
      artworkUrl,
      audioUrl,
      appleUrl,
      spotifyUrl: feed.spotifyUrl,
      description
    });
  }

  // Chronologically omit the earliest Season 1 / early episodes when configured for a feed
  rawItems.sort((a, b) => a.pubMs - b.pubMs);
  const omitCount = Number(feed.omitEarliestCount) || 0;
  const eligible = omitCount > 0 ? rawItems.slice(omitCount) : rawItems;

  const items = eligible.map(({ pubMs: _pubMs, ...rest }) => rest);

  // Prioritize short classroom-friendly episodes under 15 minutes
  items.sort((a, b) => a.durationSec - b.durationSec || b.pubDate.localeCompare(a.pubDate));
  return items;
}

async function fetchFeedEpisodes(feed) {
  const appleMaps = await fetchAppleMap(feed);
  const res = await fetch(feed.rssUrl);
  if (!res.ok) throw new Error(`RSS fetch failed for ${feed.show}: ${res.status}`);
  const xml = await res.text();
  return parseFeedEpisodesXml(xml, feed, appleMaps);
}

function pickCategoryHeuristic(ep) {
  const text = `${ep.title} ${ep.description}`.toLowerCase();
  if (/color|hue|value|line|shape|form|space|texture|primary|complementary/.test(text)) return 'Elements of Art';
  if (/balance|symmetry|contrast|emphasis|rhythm|pattern|movement|proportion|unity/.test(text)) {
    return 'Principles of Design';
  }
  if (/oil paint|tempera|watercolor|acrylic|fresco|clay|ceramic|bronze|marble|charcoal|printmaking|pastel|pigment/.test(text)) {
    return 'Materials & Media';
  }
  if (/stolen|heist|weird|strange|prank|secret|myth|funny|surprising|Guinness|record/.test(text)) {
    return 'Fun Facts';
  }
  return 'Historical & Cultural Connections';
}

function cleanFallbackFromNotes(ep, includeBonus) {
  const sentences = ep.description
    .split(/(?<=[.?!])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 28 && !/megaphone|patreon|subscribe|airwave|rainbow puppy|artsmartpodcast/i.test(s));

  const fact = sentences[0] || `Kyle explores key ideas behind ${ep.title} in this short episode.`;
  const cat = pickCategoryHeuristic(ep);
  const cueSeconds = Math.max(45, Math.min(ep.durationSec - 35, Math.round(ep.durationSec * 0.28)));

  const item = {
    category: cat,
    cueSeconds,
    cueVerified: false,
    question: `In the ${ep.show} episode "${ep.title}", which statement reflects the main story?`,
    options: [
      fact.length > 105 ? `${fact.slice(0, 102)}...` : fact,
      'The work was originally sculpted exclusively out of polar glacial ice in 1998.',
      'No museums have ever documented or discussed this subject in art history.',
      'It was invented solely as a secret naval signaling code during World War I.'
    ],
    correctIndex: 0,
    explanation: `${sentences.slice(0, 2).join(' ') || fact} Listen at the cued spot to hear the full story.`,
    bonusQuestion: null
  };

  if (includeBonus && sentences[1]) {
    item.bonusQuestion = {
      prompt: `Bonus Deep Dive: What follow-up insight connects closely to "${ep.title}"?`,
      options: [
        sentences[1].length > 105 ? `${sentences[1].slice(0, 102)}...` : sentences[1],
        'It relies exclusively on ultraviolet lasers inside a darkroom.',
        'It was banned from every European academy until 2010.',
        'It uses only synthetic plastics developed after 1975.'
      ],
      correctIndex: 0,
      explanation: sentences[1]
    };
  }

  return item;
}

async function generateWithGemini(ep, apiKey, wantBonus) {
  const promptText = [
    `You are an art educator and curriculum designer creating a trivia question for Kyle Wood's "${ep.show}" podcast episode.`,
    `Title: ${ep.title}`,
    `Duration (sec): ${ep.durationSec}`,
    `Show Notes: ${ep.description.slice(0, 1400)}`,
    `Allowed categories: ${CATEGORIES.join(', ')}.`,
    `Also download/analyze audio timestamp if audio is attached, OR estimate cueSeconds cleanly inside [45, ${Math.max(55, ep.durationSec - 35)}] where this answer is discussed.`,
    wantBonus
      ? `Include a "bonusQuestion" object that goes deeper on the same concept (for +100 bonus points), with keys: prompt, options (4), correctIndex (0..3), explanation.`
      : `Set "bonusQuestion" to null.`,
    `Return strict JSON ONLY with keys: category, cueSeconds, question, options (4 strings), correctIndex (0-3), explanation, bonusQuestion.`
  ].join('\n');

  const body = {
    contents: [{ parts: [{ text: promptText }] }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0.35 }
  };

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }
  );
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
  const payload = await res.json();
  const raw = payload?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const parsed = JSON.parse(raw);

  const safeCategory = CATEGORIES.includes(parsed.category) ? parsed.category : pickCategoryHeuristic(ep);
  const safeCue = Math.max(45, Math.min(Math.max(55, ep.durationSec - 30), Math.round(Number(parsed.cueSeconds) || ep.durationSec * 0.3)));

  return {
    category: safeCategory,
    cueSeconds: safeCue,
    cueVerified: false,
    question: String(parsed.question),
    options: Array.isArray(parsed.options) && parsed.options.length === 4 ? parsed.options.map(String) : cleanFallbackFromNotes(ep, false).options,
    correctIndex: Number.isInteger(parsed.correctIndex) && parsed.correctIndex >= 0 && parsed.correctIndex < 4 ? parsed.correctIndex : 0,
    explanation: String(parsed.explanation || ''),
    bonusQuestion: wantBonus && parsed.bonusQuestion ? parsed.bonusQuestion : null
  };
}

async function pingSupabaseKeepAlive() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return;
  try {
    await fetch(`${url.replace(/\/$/, '')}/rest/v1/rpc/cleanup_expired_art_smart_rooms`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: '{}'
    });
    console.log('Cleaned expired Supabase rooms.');
  } catch (err) {
    console.warn('Supabase keep-alive warning:', err.message);
  }
}

async function main() {
  await pingSupabaseKeepAlive();
  const existing = JSON.parse(await fs.readFile(QUESTIONS_PATH, 'utf8'));
  const knownGuids = new Set(existing.map((q) => q.guid));

  const allFetched = [];
  for (const feed of FEEDS) {
    try {
      const eps = await fetchFeedEpisodes(feed);
      allFetched.push(...eps);
    } catch (err) {
      console.warn(`Skipping feed ${feed.show}: ${err.message}`);
    }
  }

  const fresh = allFetched
    .filter((ep) => !knownGuids.has(ep.guid))
    .sort((a, b) => a.durationSec - b.durationSec)
    .slice(0, 3);

  if (!fresh.length) {
    console.log('Art Smart catalog is already synced with the latest episodes.');
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  for (let i = 0; i < fresh.length; i++) {
    const ep = fresh[i];
    const wantBonus = (existing.length + i) % 12 === 0;
    let built;
    if (apiKey) {
      try {
        built = await generateWithGemini(ep, apiKey, wantBonus);
      } catch (err) {
        console.warn(`Gemini fallback for "${ep.title}": ${err.message}`);
        built = cleanFallbackFromNotes(ep, wantBonus);
      }
    } else {
      built = cleanFallbackFromNotes(ep, wantBonus);
    }

    const record = {
      guid: ep.guid,
      show: ep.show,
      title: ep.title,
      pubDate: ep.pubDate,
      durationSec: ep.durationSec,
      artworkUrl: ep.artworkUrl,
      audioUrl: ep.audioUrl,
      appleUrl: ep.appleUrl,
      spotifyUrl: ep.spotifyUrl,
      category: built.category,
      cueSeconds: built.cueSeconds,
      cueVerified: built.cueVerified,
      question: built.question,
      options: built.options,
      correctIndex: built.correctIndex,
      explanation: built.explanation
    };
    if (built.bonusQuestion) record.bonusQuestion = built.bonusQuestion;
    existing.unshift(record);
    console.log(`Added [${ep.show}] ${ep.title} (${built.category})`);
  }

  await fs.writeFile(QUESTIONS_PATH, JSON.stringify(existing, null, 2) + '\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
