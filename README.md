# Art Smart Trivia Studio

Interactive classroom & solo art-history trivia companion powered by **250 curated short episodes** (with **20 deeper Bonus Question follow-ups**) from **Art Smart** and **Who ARTed: Weekly Art History for All Ages** by Kyle Wood.

## Highlights

- **250 Verified Short-Episode Questions** across 5 educator-ready tracks:
  - `Elements of Art` (35)
  - `Principles of Design` (32)
  - `Materials & Media` (45)
  - `Historical & Cultural Connections` (75)
  - `Fun Facts` (63 — 25.2% kid-friendly stories)
- **Instant Reveal + Cued Episode Player:** Clicking an answer choice immediately reveals whether you nailed it, awards **+100 points**, explains the story, and cues the podcast audio player right to the episode timestamp (`cueSeconds`) where you can listen to learn more.
- **Bonus Depth Opportunities (+100 Extra Points):** 8% (20 questions) unlock an optional follow-up question digging deeper into the art concept (for example, traditional subtractive primaries followed by additive RGB light primaries).
- **Classroom Live Arena (Group Mode):**
  - Pick **Random Assortment**, **Choose a Theme / Show**, or **Pick Individual Questions**.
  - Choose **10**, **20**, **30**, or **"Let’s see how far we can go!"** (continuously pulls fresh unseen questions until the host ends the round).
  - Auto-generates a **random 6-digit classroom code** (`100000–999999`) or accepts a **custom room code**, with **1 Hour**, **1 Day**, or **1 Week** room lifespan.
  - **Reset Game** at the end of any round preserves the exact code, expiration, and deck settings so teachers can reuse one code across multiple classes all day or all week.
  - Players choose their **Name** and an **Artist Avatar**.
  - **Tiered Speed Scoring:** `100` (1st correct) → `90` (2nd) → `80` (3rd) → `70` (4th) → `60` (5th) → `50` (everyone else correct, regardless of time).
  - After everyone locks in (or the timer ends), displays the answer, plays the cued clip if desired, and reveals the **Top 3 "Smartest Artists" Leaderboard**.

## Running Locally (Classroom Wi-Fi / LAN)

1. Double-click **`Start Local Game Server.command`** (or run `ruby server.rb`).
2. Open **`http://localhost:8080`**.
3. Students on the same Wi-Fi network can scan the Classroom Arena QR code (pointing to your Mac's LAN IP printed in the Host lobby & terminal) or enter the 6-digit room code.

## Optional: Online Multi-Device Sync (Supabase)

1. Create a free Supabase project and run [`supabase/schema.sql`](supabase/schema.sql) in the SQL Editor.
2. Paste your `url` and `anonKey` into `CLOUD_CONFIG` inside [`public/js/config.js`](public/js/config.js).
3. Deploy `public/` to any static host (Netlify, Vercel, GitHub Pages, or Cloudflare Pages).

## Fine-Tuning & Batch Audio Cue Verification

- **In-App Host Studio:** Open Settings (`⚙`) → **Host Cue & Question Studio**, press Play on any episode, scrub to the exact moment an explanation begins, and click **"Set Cue to Current Audio Time"** to save immediately or download an updated `questions.json`.
- **Automated Batch Cue Agent:** Set `GEMINI_API_KEY` and run:
  ```bash
  GEMINI_API_KEY=your_key node scripts/scan-audio-cues.mjs --limit=25
  ```
- **Sync New Episodes:** Run `node scripts/feed-agent.mjs` (or double-click **`Sync Latest Episode.command`**) to scan both RSS feeds for newly released short episodes.
