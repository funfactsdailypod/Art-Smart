/**
 * Art Smart Classroom Arena Transport & Scoring Engine
 * Works seamlessly across:
 *   1) Supabase cloud rooms (when CLOUD_CONFIG is set)
 *   2) Local Ruby LAN Wi-Fi Server (/api/rooms)
 *   3) Same-browser BroadcastChannel + localStorage demo mode
 */
import { CLOUD_CONFIG, GROUP_SPEED_TIERS, GROUP_DEFAULT_CORRECT_POINTS } from './config.js';

const LOCAL_ROOM_PREFIX = 'art_smart_room_';
const EXPIRY_MS = {
  '1h': 3600 * 1000,
  '1d': 86400 * 1000,
  '1w': 7 * 86400 * 1000
};

export function generateSixDigitCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export function sanitizeRoomCode(raw) {
  return String(raw || '')
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '')
    .slice(0, 24);
}

export function formatExpiryRemaining(expiresAtIso) {
  if (!expiresAtIso) return 'Active';
  const diff = Date.parse(expiresAtIso) - Date.now();
  if (diff <= 0) return 'Expired';
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(hours / 24);
  if (days >= 1) return `${days}d ${hours % 24}h left`;
  const mins = Math.floor((diff % 3600000) / 60000);
  if (hours >= 1) return `${hours}h ${mins}m left`;
  return `${Math.max(1, mins)}m left`;
}

/**
 * Exact Group Scoring Spec:
 * 1st correct = 100, 2nd = 90, 3rd = 80, 4th = 70, 5th = 60, 6th+ correct = 50, wrong = 0.
 */
export function recalculateRoomScoresClient(room, questionMap) {
  const players = room?.players;
  if (!players || typeof players !== 'object') return room;
  const guids = room.questionGuids || [];
  const totals = {};
  const correctCounts = {};
  const firstCounts = {};
  Object.keys(players).forEach((pid) => {
    totals[pid] = 0;
    correctCounts[pid] = 0;
    firstCounts[pid] = 0;
  });

  const seenQ = new Set();
  Object.values(players).forEach((p) => {
    Object.keys(p.answers || {}).forEach((q) => seenQ.add(q));
  });

  for (const qKey of seenQ) {
    const qIdx = Number(qKey);
    const guid = guids[qIdx];
    const ep = questionMap.get(guid);
    if (!ep) continue;

    const correctEntries = [];
    for (const [pid, pdata] of Object.entries(players)) {
      const ans = pdata.answers?.[qKey];
      if (!ans) continue;
      if (Number(ans.choice) === Number(ep.correctIndex)) {
        correctEntries.push([pid, ans]);
      } else {
        ans.points = 0;
        ans.correct = false;
        ans.rank = null;
      }
    }

    correctEntries.sort((a, b) => {
      const [pidA, ansA] = a;
      const [pidB, ansB] = b;
      const seqDiff = (ansA.serverSeq ?? 9e9) - (ansB.serverSeq ?? 9e9);
      if (seqDiff !== 0) return seqDiff;
      const timeDiff = (ansA.answeredAtMs ?? 9e12) - (ansB.answeredAtMs ?? 9e12);
      if (timeDiff !== 0) return timeDiff;
      return pidA.localeCompare(pidB);
    });

    correctEntries.forEach(([pid, ans], rankIdx) => {
      const pts = rankIdx < GROUP_SPEED_TIERS.length ? GROUP_SPEED_TIERS[rankIdx] : GROUP_DEFAULT_CORRECT_POINTS;
      ans.points = pts;
      ans.correct = true;
      ans.rank = rankIdx + 1;
      totals[pid] += pts;
      correctCounts[pid] += 1;
      if (rankIdx === 0) firstCounts[pid] += 1;
    });
  }

  Object.entries(players).forEach(([pid, pdata]) => {
    pdata.score = totals[pid] || 0;
    pdata.correctCount = correctCounts[pid] || 0;
    pdata.firstCount = firstCounts[pid] || 0;
  });
  return room;
}

export function getFullStandings(room) {
  const players = Object.values(room?.players || {});
  return players.sort(
    (a, b) =>
      (b.score || 0) - (a.score || 0) ||
      (b.correctCount || 0) - (a.correctCount || 0) ||
      (b.firstCount || 0) - (a.firstCount || 0) ||
      String(a.name || '').localeCompare(String(b.name || ''))
  );
}

export function getTopSmartestArtists(room, count = 3) {
  return getFullStandings(room).slice(0, count);
}

export function buildStandingsCsv(room) {
  const rows = [['Rank', 'Artist Name', 'Avatar', 'Total Points', 'Correct Answers', 'First-to-Answer Wins']];
  getFullStandings(room).forEach((p, idx) => {
    rows.push([
      String(idx + 1),
      `"${String(p.name || 'Artist').replace(/"/g, '""')}"`,
      p.avatar || '',
      String(p.score || 0),
      String(p.correctCount || 0),
      String(p.firstCount || 0)
    ]);
  });
  return rows.map((r) => r.join(',')).join('\n');
}

export class ClassroomArenaClient {
  constructor() {
    this.mode = 'local-browser';
    this.healthInfo = null;
    this.channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('art_smart_rooms_v1') : null;
    this.questionMap = new Map();
  }

  setQuestionMap(map) {
    this.questionMap = map;
  }

  hasSupabase() {
    return Boolean(CLOUD_CONFIG.url && CLOUD_CONFIG.anonKey);
  }

  pingKeepAlive() {
    if (!this.hasSupabase() || typeof fetch !== 'function') return;
    try {
      const base = CLOUD_CONFIG.url.replace(/\/$/, '');
      const headers = {
        apikey: CLOUD_CONFIG.anonKey,
        Authorization: `Bearer ${CLOUD_CONFIG.anonKey}`
      };
      // Lightweight SELECT ping on every site load to reset Supabase's 7-day inactivity timer
      fetch(`${base}/rest/v1/art_smart_rooms?select=code&limit=1`, {
        method: 'GET',
        headers,
        cache: 'no-store'
      }).catch(() => {});
      // Opportunistically clean up expired rooms in the background
      fetch(`${base}/rest/v1/rpc/cleanup_expired_art_smart_rooms`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: '{}'
      }).catch(() => {});
    } catch {
      // Ignore background keep-alive errors
    }
  }

  async detectBackend() {
    if (this.hasSupabase()) {
      this.mode = 'supabase';
      this.pingKeepAlive();
      return { mode: 'supabase', lanUrl: null };
    }
    try {
      const res = await fetch('/api/health', { cache: 'no-store' });
      if (res.ok) {
        const info = await res.json();
        this.mode = 'local-server';
        this.healthInfo = info;
        return {
          mode: 'local-server',
          lanUrl: info.lanIp ? `http://${info.lanIp}:${info.port || 8080}` : window.location.origin
        };
      }
    } catch {
      // Static file / serverless without Ruby backend falls back cleanly to browser BroadcastChannel
    }
    this.mode = 'local-browser';
    return { mode: 'local-browser', lanUrl: null };
  }

  getSupabaseHeaders() {
    return {
      apikey: CLOUD_CONFIG.anonKey,
      Authorization: `Bearer ${CLOUD_CONFIG.anonKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation'
    };
  }

  toSupabaseRow(room) {
    return {
      code: room.code,
      host_id: room.hostId,
      status: room.status,
      current_index: room.currentIndex,
      question_guids: room.questionGuids,
      players: room.players,
      settings: {
        hostName: room.hostName,
        title: room.title,
        questionMode: room.questionMode,
        theme: room.theme,
        showFilter: room.showFilter,
        questionCount: room.questionCount,
        isEndless: room.isEndless,
        pacing: room.pacing,
        timerSec: room.timerSec,
        expiryKey: room.expiryKey,
        showAudioCue: Boolean(room.showAudioCue),
        answerSeq: room.answerSeq || 0
      },
      question_started_at: room.questionStartedAtMs ? new Date(room.questionStartedAtMs).toISOString() : null,
      expires_at: room.expiresAt,
      updated_at: new Date().toISOString()
    };
  }

  fromSupabaseRow(row) {
    const s = row.settings || {};
    return {
      code: row.code,
      hostId: row.host_id,
      hostName: s.hostName || 'Game Leader',
      title: s.title || 'Art Smart Group Game',
      status: row.status,
      currentIndex: row.current_index || 0,
      questionMode: s.questionMode || 'random',
      theme: s.theme || 'All',
      showFilter: s.showFilter || 'All',
      questionCount: s.questionCount ?? 10,
      isEndless: Boolean(s.isEndless),
      questionGuids: Array.isArray(row.question_guids) ? row.question_guids : [],
      players: row.players || {},
      pacing: s.pacing || 'timed',
      timerSec: s.timerSec ?? 25,
      expiryKey: s.expiryKey || '1d',
      showAudioCue: Boolean(s.showAudioCue),
      answerSeq: s.answerSeq || 0,
      questionStartedAtMs: row.question_started_at ? Date.parse(row.question_started_at) : null,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  readLocalStorageRoom(code) {
    try {
      const raw = localStorage.getItem(`${LOCAL_ROOM_PREFIX}${code}`);
      if (!raw) return null;
      const r = JSON.parse(raw);
      if (r.expiresAt && Date.parse(r.expiresAt) < Date.now()) {
        localStorage.removeItem(`${LOCAL_ROOM_PREFIX}${code}`);
        return null;
      }
      return r;
    } catch {
      return null;
    }
  }

  writeLocalStorageRoom(room) {
    try {
      localStorage.setItem(`${LOCAL_ROOM_PREFIX}${room.code}`, JSON.stringify(room));
      this.channel?.postMessage({ type: 'room-update', code: room.code });
    } catch {
      // Ignore storage quota issues
    }
  }

  async createRoom(opts) {
    const code = sanitizeRoomCode(opts.code) || generateSixDigitCode();
    const expiryKey = EXPIRY_MS[opts.expiryKey] ? opts.expiryKey : '1d';
    const expiresAt = new Date(Date.now() + EXPIRY_MS[expiryKey]).toISOString();

    const payload = {
      code,
      hostId: opts.hostId,
      hostName: opts.hostName || 'Game Leader',
      title: opts.title || 'Art Smart Group Game',
      status: 'lobby',
      currentIndex: 0,
      questionMode: opts.questionMode || 'random',
      theme: opts.theme || 'All',
      showFilter: opts.showFilter || 'All',
      questionCount: opts.isEndless ? 'endless' : opts.questionCount,
      isEndless: Boolean(opts.isEndless),
      questionGuids: opts.questionGuids || [],
      pacing: opts.pacing || 'timed',
      timerSec: opts.timerSec ?? 25,
      expiryKey,
      expiresAt,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      questionStartedAtMs: null,
      answerSeq: 0,
      showAudioCue: false,
      players: {}
    };

    if (this.mode === 'local-server') {
      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not create game room.');
      return data;
    }

    if (this.mode === 'supabase') {
      const base = CLOUD_CONFIG.url.replace(/\/$/, '');
      const res = await fetch(`${base}/rest/v1/art_smart_rooms`, {
        method: 'POST',
        headers: this.getSupabaseHeaders(),
        body: JSON.stringify(this.toSupabaseRow(payload))
      });
      if (!res.ok) {
        const msg = await res.text();
        if (res.status === 409 || /duplicate/i.test(msg)) {
          const nowIso = encodeURIComponent(new Date().toISOString());
          await fetch(
            `${base}/rest/v1/art_smart_rooms?code=eq.${encodeURIComponent(code)}&expires_at=lte.${nowIso}`,
            { method: 'DELETE', headers: this.getSupabaseHeaders() }
          ).catch(() => {});
          const retry = await fetch(`${base}/rest/v1/art_smart_rooms`, {
            method: 'POST',
            headers: this.getSupabaseHeaders(),
            body: JSON.stringify(this.toSupabaseRow(payload))
          });
          if (retry.ok) {
            const retryRows = await retry.json();
            return this.fromSupabaseRow(retryRows[0] || this.toSupabaseRow(payload));
          }
          throw new Error(`Code "${code}" is already active! Pick another code, click 🎲 6-Digit, or reopen your saved game below.`);
        }
        throw new Error('Could not create game room on server. Please try again.');
      }
      const rows = await res.json();
      return this.fromSupabaseRow(rows[0] || this.toSupabaseRow(payload));
    }

    const existing = this.readLocalStorageRoom(code);
    if (existing) throw new Error(`Code "${code}" is already active in this browser.`);
    this.writeLocalStorageRoom(payload);
    return payload;
  }

  async fetchRoom(code) {
    const clean = sanitizeRoomCode(code);
    if (!clean) throw new Error('Enter a valid room code.');

    if (this.mode === 'local-server') {
      const res = await fetch(`/api/rooms/${encodeURIComponent(clean)}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Room not found or expired.');
      return recalculateRoomScoresClient(data, this.questionMap);
    }

    if (this.mode === 'supabase') {
      const base = CLOUD_CONFIG.url.replace(/\/$/, '');
      const res = await fetch(`${base}/rest/v1/art_smart_rooms?code=eq.${encodeURIComponent(clean)}&select=*`, {
        headers: this.getSupabaseHeaders()
      });
      if (!res.ok) throw new Error('Could not connect to room.');
      const rows = await res.json();
      if (!rows.length) throw new Error('Game code not found or expired.');
      return recalculateRoomScoresClient(this.fromSupabaseRow(rows[0]), this.questionMap);
    }

    const r = this.readLocalStorageRoom(clean);
    if (!r) throw new Error('Game code not found in local demo mode.');
    return recalculateRoomScoresClient(r, this.questionMap);
  }

  async mutateRoom(code, bodyBuilder) {
    const clean = sanitizeRoomCode(code);
    if (this.mode === 'local-server') {
      const res = await fetch(`/api/rooms/${encodeURIComponent(clean)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyBuilder.serverPayload)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Room update failed.');
      return recalculateRoomScoresClient(data, this.questionMap);
    }

    const current = await this.fetchRoom(clean);
    const updated = bodyBuilder.applyLocal(JSON.parse(JSON.stringify(current)));
    updated.updatedAt = new Date().toISOString();
    recalculateRoomScoresClient(updated, this.questionMap);

    if (this.mode === 'supabase') {
      const base = CLOUD_CONFIG.url.replace(/\/$/, '');
      const res = await fetch(`${base}/rest/v1/art_smart_rooms?code=eq.${encodeURIComponent(clean)}`, {
        method: 'PATCH',
        headers: this.getSupabaseHeaders(),
        body: JSON.stringify(this.toSupabaseRow(updated))
      });
      if (!res.ok) throw new Error('Could not sync update to Supabase.');
      const rows = await res.json();
      return recalculateRoomScoresClient(this.fromSupabaseRow(rows[0] || this.toSupabaseRow(updated)), this.questionMap);
    }

    this.writeLocalStorageRoom(updated);
    return updated;
  }

  joinRoom(code, player) {
    return this.mutateRoom(code, {
      serverPayload: { action: 'join', player },
      applyLocal: (room) => {
        room.players = room.players || {};
        const prev = room.players[player.id] || {};
        room.players[player.id] = {
          id: player.id,
          name: player.name.slice(0, 24),
          avatar: player.avatar || 'painter',
          joinedAt: prev.joinedAt || new Date().toISOString(),
          score: prev.score || 0,
          correctCount: prev.correctCount || 0,
          firstCount: prev.firstCount || 0,
          answers: prev.answers || {}
        };
        return room;
      }
    });
  }

  submitAnswer(code, playerId, qIndex, choice) {
    const nowMs = Date.now();
    return this.mutateRoom(code, {
      serverPayload: { action: 'answer', playerId, qIndex, choice, answeredAtMs: nowMs },
      applyLocal: (room) => {
        const p = room.players?.[playerId];
        if (!p) throw new Error('Player is not in this group game.');
        p.answers = p.answers || {};
        const key = String(qIndex);
        if (!p.answers[key]) {
          room.answerSeq = (room.answerSeq || 0) + 1;
          p.answers[key] = { choice, answeredAtMs: nowMs, serverSeq: room.answerSeq, points: 0, correct: false, rank: null };
        }
        return room;
      }
    });
  }

  hostUpdateRoom(code, patch) {
    return this.mutateRoom(code, {
      serverPayload: { action: 'hostUpdate', patch },
      applyLocal: (room) => Object.assign(room, patch)
    });
  }

  appendEndlessQuestions(code, extraGuids, nextIndex, nextStartedAtMs) {
    return this.mutateRoom(code, {
      serverPayload: {
        action: 'appendQuestions',
        extraGuids,
        nextIndex,
        status: 'question',
        questionStartedAtMs: nextStartedAtMs
      },
      applyLocal: (room) => {
        const seen = new Set(room.questionGuids || []);
        for (const g of extraGuids) {
          if (!seen.has(g)) {
            room.questionGuids.push(g);
            seen.add(g);
          }
        }
        room.currentIndex = nextIndex;
        room.status = 'question';
        room.questionStartedAtMs = nextStartedAtMs;
        return room;
      }
    });
  }

  resetRoomForNextClass(code, newQuestionGuids = null) {
    return this.mutateRoom(code, {
      serverPayload: { action: 'reset', newQuestionGuids },
      applyLocal: (room) => {
        room.status = 'lobby';
        room.currentIndex = 0;
        room.questionStartedAtMs = null;
        room.answerSeq = 0;
        room.showAudioCue = false;
        room.players = {};
        if (Array.isArray(newQuestionGuids) && newQuestionGuids.length) {
          room.questionGuids = newQuestionGuids;
        }
        return room;
      }
    });
  }
}

export const arenaClient = new ClassroomArenaClient();
