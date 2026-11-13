#!/usr/bin/env node
/**
 * Batch Audio Cue Verifier for Art Smart & Who ARTed
 * Uses Gemini Flash multimodal audio understanding to pinpoint the exact
 * timestamp (cueSeconds) inside an episode MP3 where each trivia question's
 * answer is explained, and marks cueVerified = true.
 *
 * Usage:
 *   GEMINI_API_KEY=... node scripts/scan-audio-cues.mjs --limit=15
 *   GEMINI_API_KEY=... node scripts/scan-audio-cues.mjs --guid=<guid>
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const QUESTIONS_PATH = path.resolve(__dirname, '..', 'public', 'data', 'questions.json');

function parseArgs() {
  const out = { limit: 10, guid: null, force: false };
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--limit=')) out.limit = Math.max(1, parseInt(arg.slice(8), 10) || 10);
    if (arg.startsWith('--guid=')) out.guid = arg.slice(7).trim();
    if (arg === '--force') out.force = true;
  }
  return out;
}

async function detectCueFromAudio(item, apiKey) {
  const audioRes = await fetch(item.audioUrl);
  if (!audioRes.ok) throw new Error(`Audio download failed (${audioRes.status})`);
  const buf = Buffer.from(await audioRes.arrayBuffer());
  // Keep inline payload under ~18 MB for Gemini inlineData (short episodes fit cleanly)
  if (buf.byteLength > 18 * 1024 * 1024) {
    throw new Error(`Audio file exceeds 18MB inline limit (${Math.round(buf.byteLength / 1048576)}MB)`);
  }

  const answerText = item.options?.[item.correctIndex] || '';
  const prompt = [
    `Listen to this podcast episode ("${item.show}: ${item.title}").`,
    `Find the EXACT timestamp in MM:SS (and total integer seconds) when the host introduces or explains this trivia fact:`,
    `Question: ${item.question}`,
    `Answer: ${answerText}`,
    `Explanation: ${item.explanation}`,
    `Pick a timestamp about 3 to 5 seconds BEFORE the key sentence so a listener hears clean context.`,
    `Respond with strict JSON only: { "cueSeconds": <integer>, "confidence": "high"|"medium"|"low", "quote": "<short opening phrase heard at cue>" }`
  ].join('\n');

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { inlineData: { mimeType: 'audio/mpeg', data: buf.toString('base64') } },
              { text: prompt }
            ]
          }
        ],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.1 }
      })
    }
  );

  if (!res.ok) throw new Error(`Gemini error HTTP ${res.status}`);
  const payload = await res.json();
  const parsed = JSON.parse(payload?.candidates?.[0]?.content?.parts?.[0]?.text || '{}');
  const sec = Math.round(Number(parsed.cueSeconds));
  if (!Number.isFinite(sec) || sec < 0 || sec >= item.durationSec) {
    throw new Error(`Out-of-bounds cueSeconds: ${parsed.cueSeconds}`);
  }
  return { cueSeconds: sec, quote: parsed.quote || '', confidence: parsed.confidence || 'medium' };
}

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('Set GEMINI_API_KEY in your environment first.');
    process.exit(1);
  }

  const args = parseArgs();
  const list = JSON.parse(await fs.readFile(QUESTIONS_PATH, 'utf8'));
  const targets = list.filter((q) => (args.guid ? q.guid === args.guid : args.force || !q.cueVerified)).slice(0, args.limit);

  if (!targets.length) {
    console.log('All selected episodes already have verified cues!');
    return;
  }

  let updated = 0;
  for (const item of targets) {
    console.log(`Scanning audio for "${item.title}" (${item.durationSec}s)...`);
    try {
      const result = await detectCueFromAudio(item, apiKey);
      item.cueSeconds = result.cueSeconds;
      item.cueVerified = true;
      updated++;
      console.log(`  -> Verified cue at ${result.cueSeconds}s (${result.confidence}) "${result.quote}"`);
    } catch (err) {
      console.warn(`  -> Skipped: ${err.message}`);
    }
  }

  if (updated > 0) {
    await fs.writeFile(QUESTIONS_PATH, JSON.stringify(list, null, 2) + '\n');
    console.log(`Saved ${updated} verified audio cue timestamp(s) to public/data/questions.json.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
