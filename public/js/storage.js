/**
 * Art Smart Client-Side Persistence, Saved Game Bookmarks, Mastery Stats & Sync Codes
 */
import { SOLO_POINTS_PER_CORRECT, BONUS_POINTS_PER_CORRECT, BADGE_DEFS } from './config.js';

const STORAGE_KEY = 'art_smart_trivia_state_v1';

const DEFAULT_STATE = {
  score: 0,
  streak: 0,
  bestStreak: 0,
  answeredCount: 0,
  correctCount: 0,
  bonusAttempted: 0,
  bonusCorrect: 0,
  clipsListened: 0,
  groupGamesPlayed: 0,
  categoryCounts: {},
  answered: {},
  favorites: [],
  playlists: [],
  packUnchecked: {},
  savedRooms: [],
  hostOverrides: {},
  unlockedBadges: [],
  settings: {
    soundEnabled: true,
    autoCueOnReveal: false,
    playerName: '',
    playerAvatar: 'painter',
    hostName: 'Game Leader'
  }
};

function cloneDefault() {
  return JSON.parse(JSON.stringify(DEFAULT_STATE));
}

export class StorageManager {
  constructor() {
    this.state = this.load();
    this.listeners = new Set();
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    for (const fn of this.listeners) fn(this.state);
  }

  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return cloneDefault();
      const parsed = JSON.parse(raw);
      return {
        ...cloneDefault(),
        ...parsed,
        categoryCounts: { ...(parsed.categoryCounts || {}) },
        answered: { ...(parsed.answered || {}) },
        favorites: Array.isArray(parsed.favorites) ? parsed.favorites : [],
        playlists: Array.isArray(parsed.playlists)
          ? parsed.playlists.map((pl) => ({
              ...pl,
              guids: Array.isArray(pl.guids) ? pl.guids : [],
              uncheckedGuids: Array.isArray(pl.uncheckedGuids) ? pl.uncheckedGuids : []
            }))
          : [],
        packUnchecked: parsed.packUnchecked && typeof parsed.packUnchecked === 'object' ? { ...parsed.packUnchecked } : {},
        savedRooms: Array.isArray(parsed.savedRooms) ? parsed.savedRooms : [],
        hostOverrides: { ...(parsed.hostOverrides || {}) },
        unlockedBadges: Array.isArray(parsed.unlockedBadges) ? parsed.unlockedBadges : [],
        settings: { ...cloneDefault().settings, ...(parsed.settings || {}) }
      };
    } catch {
      return cloneDefault();
    }
  }

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      // Ignore storage quota issues in restricted browsing modes
    }
    this.emit();
  }

  getState() {
    return this.state;
  }

  updateSettings(patch) {
    this.state.settings = { ...this.state.settings, ...patch };
    this.save();
  }

  recordSoloAnswer(ep, choiceIndex) {
    const existing = this.state.answered[ep.guid];
    if (existing && typeof existing.choice === 'number') {
      return { alreadyAnswered: true, isCorrect: existing.correct, pointsDelta: 0, newlyUnlocked: [] };
    }

    const isCorrect = Number(choiceIndex) === Number(ep.correctIndex);
    const pointsDelta = isCorrect ? SOLO_POINTS_PER_CORRECT : 0;

    this.state.answeredCount += 1;
    if (isCorrect) {
      this.state.correctCount += 1;
      this.state.score += pointsDelta;
      this.state.streak += 1;
      this.state.bestStreak = Math.max(this.state.bestStreak, this.state.streak);
      this.state.categoryCounts[ep.category] = (this.state.categoryCounts[ep.category] || 0) + 1;
    } else {
      this.state.streak = 0;
    }

    this.state.answered[ep.guid] = {
      choice: choiceIndex,
      correct: isCorrect,
      pointsEarned: pointsDelta,
      bonusChoice: null,
      bonusCorrect: null,
      answeredAt: new Date().toISOString()
    };

    const newlyUnlocked = this.evaluateBadges();
    this.save();
    return { alreadyAnswered: false, isCorrect, pointsDelta, newlyUnlocked };
  }

  recordBonusAnswer(ep, bonusChoiceIndex) {
    const rec = this.state.answered[ep.guid];
    if (!ep.bonusQuestion || !rec || (rec.bonusChoice !== null && rec.bonusChoice !== undefined)) {
      return { alreadyAnswered: true, isCorrect: Boolean(rec?.bonusCorrect), pointsDelta: 0, newlyUnlocked: [] };
    }

    const isCorrect = Number(bonusChoiceIndex) === Number(ep.bonusQuestion.correctIndex);
    const pointsDelta = isCorrect ? BONUS_POINTS_PER_CORRECT : 0;

    this.state.bonusAttempted += 1;
    if (isCorrect) {
      this.state.bonusCorrect += 1;
      this.state.score += pointsDelta;
    }

    rec.bonusChoice = bonusChoiceIndex;
    rec.bonusCorrect = isCorrect;
    rec.pointsEarned = (rec.pointsEarned || 0) + pointsDelta;

    const newlyUnlocked = this.evaluateBadges();
    this.save();
    return { alreadyAnswered: false, isCorrect, pointsDelta, newlyUnlocked };
  }

  recordClipListened() {
    this.state.clipsListened = (this.state.clipsListened || 0) + 1;
    const newlyUnlocked = this.evaluateBadges();
    this.save();
    return newlyUnlocked;
  }

  recordGroupGamePlayed() {
    this.state.groupGamesPlayed = (this.state.groupGamesPlayed || 0) + 1;
    const newlyUnlocked = this.evaluateBadges();
    this.save();
    return newlyUnlocked;
  }

  evaluateBadges() {
    const unlockedSet = new Set(this.state.unlockedBadges);
    const newlyUnlocked = [];
    for (const badge of BADGE_DEFS) {
      if (!unlockedSet.has(badge.id) && badge.check(this.state)) {
        unlockedSet.add(badge.id);
        newlyUnlocked.push(badge);
      }
    }
    this.state.unlockedBadges = Array.from(unlockedSet);
    return newlyUnlocked;
  }

  toggleFavorite(guid) {
    const idx = this.state.favorites.indexOf(guid);
    if (idx === -1) this.state.favorites.push(guid);
    else this.state.favorites.splice(idx, 1);
    this.save();
    return idx === -1;
  }

  isFavorite(guid) {
    return this.state.favorites.includes(guid);
  }

  createPlaylist(name, initialGuids = []) {
    const trimmed = String(name || '').trim().slice(0, 48);
    if (!trimmed) return null;
    const pl = {
      id: `pl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      name: trimmed,
      guids: Array.from(new Set(initialGuids)),
      uncheckedGuids: [],
      createdAt: new Date().toISOString()
    };
    this.state.playlists.unshift(pl);
    this.save();
    return pl;
  }

  deletePlaylist(id) {
    this.state.playlists = this.state.playlists.filter((p) => p.id !== id);
    this.save();
  }

  addToPlaylist(playlistId, guid) {
    const pl = this.state.playlists.find((p) => p.id === playlistId);
    if (!pl) return false;
    if (!pl.guids.includes(guid)) {
      pl.guids.push(guid);
    }
    if (Array.isArray(pl.uncheckedGuids)) {
      pl.uncheckedGuids = pl.uncheckedGuids.filter((g) => g !== guid);
    }
    this.save();
    return true;
  }

  addManyToPlaylist(playlistId, guids = []) {
    const pl = this.state.playlists.find((p) => p.id === playlistId);
    if (!pl) return 0;
    let added = 0;
    pl.uncheckedGuids = Array.isArray(pl.uncheckedGuids) ? pl.uncheckedGuids : [];
    for (const g of guids) {
      if (!pl.guids.includes(g)) {
        pl.guids.push(g);
        added++;
      }
      pl.uncheckedGuids = pl.uncheckedGuids.filter((x) => x !== g);
    }
    this.save();
    return added;
  }

  removeFromPlaylist(playlistId, guid) {
    const pl = this.state.playlists.find((p) => p.id === playlistId);
    if (!pl) return;
    pl.guids = pl.guids.filter((g) => g !== guid);
    if (Array.isArray(pl.uncheckedGuids)) {
      pl.uncheckedGuids = pl.uncheckedGuids.filter((g) => g !== guid);
    }
    this.save();
  }

  isPlaylistGuidChecked(playlistId, guid) {
    const pl = this.state.playlists.find((p) => p.id === playlistId);
    if (!pl) return true;
    return !Array.isArray(pl.uncheckedGuids) || !pl.uncheckedGuids.includes(guid);
  }

  setPlaylistGuidChecked(playlistId, guid, checked) {
    const pl = this.state.playlists.find((p) => p.id === playlistId);
    if (!pl) return;
    const set = new Set(Array.isArray(pl.uncheckedGuids) ? pl.uncheckedGuids : []);
    if (checked) set.delete(guid);
    else set.add(guid);
    pl.uncheckedGuids = Array.from(set);
    this.save();
  }

  setAllPlaylistGuidsChecked(playlistId, checked) {
    const pl = this.state.playlists.find((p) => p.id === playlistId);
    if (!pl) return;
    pl.uncheckedGuids = checked ? [] : [...pl.guids];
    this.save();
  }

  getCheckedPlaylistGuids(playlistId) {
    const pl = this.state.playlists.find((p) => p.id === playlistId);
    if (!pl) return [];
    const unchecked = new Set(Array.isArray(pl.uncheckedGuids) ? pl.uncheckedGuids : []);
    return pl.guids.filter((g) => !unchecked.has(g));
  }

  isPackGuidChecked(packId, guid) {
    const arr = this.state.packUnchecked?.[packId];
    return !Array.isArray(arr) || !arr.includes(guid);
  }

  setPackGuidChecked(packId, guid, checked) {
    if (!this.state.packUnchecked || typeof this.state.packUnchecked !== 'object') {
      this.state.packUnchecked = {};
    }
    const set = new Set(Array.isArray(this.state.packUnchecked[packId]) ? this.state.packUnchecked[packId] : []);
    if (checked) set.delete(guid);
    else set.add(guid);
    this.state.packUnchecked[packId] = Array.from(set);
    this.save();
  }

  setAllPackGuidsChecked(packId, allGuids, checked) {
    if (!this.state.packUnchecked || typeof this.state.packUnchecked !== 'object') {
      this.state.packUnchecked = {};
    }
    this.state.packUnchecked[packId] = checked ? [] : [...allGuids];
    this.save();
  }

  reorderPlaylist(playlistId, fromIndex, toIndex) {
    const pl = this.state.playlists.find((p) => p.id === playlistId);
    if (!pl) return;
    if (fromIndex < 0 || toIndex < 0 || fromIndex >= pl.guids.length || toIndex >= pl.guids.length) return;
    const [moved] = pl.guids.splice(fromIndex, 1);
    pl.guids.splice(toIndex, 0, moved);
    this.save();
  }

  saveTeacherRoom(roomSummary) {
    const now = Date.now();
    const cleaned = this.state.savedRooms.filter(
      (r) => r.code !== roomSummary.code && (!r.expiresAt || Date.parse(r.expiresAt) > now)
    );
    cleaned.unshift(roomSummary);
    this.state.savedRooms = cleaned.slice(0, 12);
    this.save();
  }

  removeTeacherRoom(code) {
    this.state.savedRooms = this.state.savedRooms.filter((r) => r.code !== code);
    this.save();
  }

  setHostOverride(guid, override) {
    this.state.hostOverrides[guid] = { ...(this.state.hostOverrides[guid] || {}), ...override };
    this.save();
  }

  clearHostOverrides() {
    this.state.hostOverrides = {};
    this.save();
  }

  exportSyncCode() {
    const payload = JSON.stringify(this.state);
    const bytes = new TextEncoder().encode(payload);
    let bin = '';
    bytes.forEach((b) => {
      bin += String.fromCharCode(b);
    });
    return `AS1-${btoa(bin)}`;
  }

  importSyncCode(code) {
    const trimmed = String(code || '').trim();
    if (!trimmed.startsWith('AS1-')) {
      throw new Error('Sync code must start with AS1-');
    }
    const b64 = trimmed.slice(4);
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    if (typeof parsed !== 'object' || !parsed) throw new Error('Invalid sync payload.');
    this.state = { ...cloneDefault(), ...parsed };
    this.save();
    return this.state;
  }

  resetAllProgress() {
    const preserved = {
      settings: this.state.settings,
      hostOverrides: this.state.hostOverrides,
      savedRooms: this.state.savedRooms
    };
    this.state = { ...cloneDefault(), ...preserved };
    this.save();
  }
}

export const storage = new StorageManager();
