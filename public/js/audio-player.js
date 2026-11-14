/**
 * Embedded & Persistent Podcast Audio Controller
 * Supports reliable cued timestamp seeking (cueTo) across Megaphone MP3 streams
 * and mirrors state to both the inline Answer Reveal player and docked mini-bar.
 */
import { SHOW_META } from './config.js';

export function formatTime(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${String(rem).padStart(2, '0')}`;
}

export class PodcastAudioController {
  constructor() {
    this.audio = new Audio();
    this.audio.preload = 'metadata';
    this.currentEpisode = null;
    this.pendingSeek = null;
    this.rates = [1, 1.25, 1.5, 2];
    this.rateIndex = 0;
    this.listeners = new Set();

    this.els = {};
    this.bindAudioEvents();
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    const snapshot = this.getSnapshot();
    for (const fn of this.listeners) fn(snapshot);
  }

  getSnapshot() {
    const ep = this.currentEpisode;
    const duration = Number.isFinite(this.audio.duration) && this.audio.duration > 0
      ? this.audio.duration
      : (ep?.durationSec || 0);
    const current = this.audio.currentTime || 0;
    return {
      episode: ep,
      isPlaying: !this.audio.paused && !this.audio.ended,
      currentTime: current,
      duration,
      cueSeconds: ep?.cueSeconds || 0,
      rate: this.rates[this.rateIndex],
      hasError: Boolean(this.lastError)
    };
  }

  mountDom() {
    this.els = {
      bar: document.getElementById('audioPlayerBar'),
      drawer: document.getElementById('playerDrawer'),
      expandBtn: document.getElementById('playerExpandBtn'),
      miniArt: document.getElementById('miniPlayerArt'),
      miniShow: document.getElementById('miniPlayerShow'),
      miniTitle: document.getElementById('miniPlayerTitle'),
      miniTime: document.getElementById('miniPlayerTime'),
      miniPlayBtn: document.getElementById('miniPlayBtn'),
      miniBackBtn: document.getElementById('miniBackBtn'),
      miniFwdBtn: document.getElementById('miniFwdBtn'),
      miniCueBtn: document.getElementById('miniCueBtn'),
      drawerArt: document.getElementById('drawerPlayerArt'),
      drawerShow: document.getElementById('drawerPlayerShow'),
      drawerTitle: document.getElementById('drawerPlayerTitle'),
      drawerPlayBtn: document.getElementById('drawerPlayBtn'),
      drawerBackBtn: document.getElementById('drawerBackBtn'),
      drawerFwdBtn: document.getElementById('drawerFwdBtn'),
      drawerCueBtn: document.getElementById('drawerCueBtn'),
      drawerRateBtn: document.getElementById('drawerRateBtn'),
      drawerSeek: document.getElementById('drawerSeekRange'),
      drawerCurrent: document.getElementById('drawerCurrentTime'),
      drawerDuration: document.getElementById('drawerDurationTime'),
      drawerCloseBtn: document.getElementById('drawerCloseBtn'),
      toast: document.getElementById('playerToast')
    };

    this.els.miniPlayBtn?.addEventListener('click', () => this.togglePlay());
    this.els.drawerPlayBtn?.addEventListener('click', () => this.togglePlay());
    this.els.miniBackBtn?.addEventListener('click', () => this.nudge(-15));
    this.els.drawerBackBtn?.addEventListener('click', () => this.nudge(-15));
    this.els.miniFwdBtn?.addEventListener('click', () => this.nudge(15));
    this.els.drawerFwdBtn?.addEventListener('click', () => this.nudge(15));
    this.els.miniCueBtn?.addEventListener('click', () => this.jumpToCue(true));
    this.els.drawerCueBtn?.addEventListener('click', () => this.jumpToCue(true));
    this.els.drawerRateBtn?.addEventListener('click', () => this.cycleRate());
    this.els.expandBtn?.addEventListener('click', () => this.toggleDrawer());
    this.els.drawerCloseBtn?.addEventListener('click', () => this.toggleDrawer(false));

    this.els.drawerSeek?.addEventListener('input', (e) => {
      const pct = Number(e.target.value) / 1000;
      const dur = Number.isFinite(this.audio.duration) && this.audio.duration > 0
        ? this.audio.duration
        : (this.currentEpisode?.durationSec || 0);
      if (dur > 0) this.seekTo(pct * dur);
    });
  }

  bindAudioEvents() {
    const applyPendingSeek = () => {
      if (this.pendingSeek !== null && Number.isFinite(this.audio.duration) && this.audio.duration > 0) {
        const clamped = Math.max(0, Math.min(this.audio.duration - 2, this.pendingSeek));
        try {
          this.audio.currentTime = clamped;
          this.pendingSeek = null;
        } catch {
          // Wait for canplay if metadata seek throws on iOS Safari
        }
      }
      this.syncDom();
      this.emit();
    };

    this.audio.addEventListener('loadedmetadata', applyPendingSeek);
    this.audio.addEventListener('canplay', applyPendingSeek);
    this.audio.addEventListener('timeupdate', () => {
      this.syncDom();
      this.emit();
    });
    this.audio.addEventListener('play', () => {
      this.lastError = null;
      this.syncDom();
      this.emit();
    });
    this.audio.addEventListener('pause', () => {
      this.syncDom();
      this.emit();
    });
    this.audio.addEventListener('ended', () => {
      this.syncDom();
      this.emit();
    });
    this.audio.addEventListener('error', () => {
      this.lastError = 'Stream unavailable offline — use Apple or Spotify links.';
      this.syncDom();
      this.emit();
    });
  }

  loadAndCue(episode, cueSeconds = episode.cueSeconds || 0, autoPlay = false) {
    if (!episode || !episode.audioUrl) return;
    const isSame = this.currentEpisode && this.currentEpisode.guid === episode.guid;
    this.currentEpisode = episode;
    this.lastError = null;
    const targetSec = Math.max(0, Math.min((episode.durationSec || 600) - 5, Number(cueSeconds) || 0));

    if (!isSame || this.audio.src !== episode.audioUrl) {
      this.pendingSeek = targetSec;
      this.audio.src = episode.audioUrl;
      this.audio.playbackRate = this.rates[this.rateIndex];
      this.audio.load();
    } else {
      this.seekTo(targetSec);
    }

    if (this.els.bar) {
      this.els.bar.classList.remove('hidden');
      document.body.classList.add('has-audio-bar');
    }

    if (autoPlay) {
      const p = this.audio.play();
      if (p && typeof p.catch === 'function') {
        p.catch(() => {
          this.syncDom();
          this.emit();
        });
      }
    }

    this.syncDom();
    this.emit();
  }

  seekTo(seconds) {
    const s = Math.max(0, Number(seconds) || 0);
    if (this.audio.readyState >= 1 && Number.isFinite(this.audio.duration)) {
      this.audio.currentTime = Math.min(this.audio.duration - 1, s);
      this.pendingSeek = null;
    } else {
      this.pendingSeek = s;
    }
    this.syncDom();
    this.emit();
  }

  jumpToCue(autoPlay = true) {
    if (!this.currentEpisode) return;
    this.loadAndCue(this.currentEpisode, this.currentEpisode.cueSeconds || 0, autoPlay);
  }

  togglePlay() {
    if (!this.currentEpisode) return;
    if (this.audio.paused || this.audio.ended) {
      const p = this.audio.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } else {
      this.audio.pause();
    }
    this.syncDom();
    this.emit();
  }

  pause() {
    if (!this.audio.paused) {
      this.audio.pause();
      this.syncDom();
      this.emit();
    }
  }

  nudge(deltaSec) {
    if (!this.currentEpisode) return;
    const base = this.pendingSeek !== null ? this.pendingSeek : (this.audio.currentTime || 0);
    this.seekTo(base + deltaSec);
  }

  cycleRate() {
    this.rateIndex = (this.rateIndex + 1) % this.rates.length;
    this.audio.playbackRate = this.rates[this.rateIndex];
    this.syncDom();
    this.emit();
  }

  toggleDrawer(forceOpen) {
    if (!this.els.drawer) return;
    const open = typeof forceOpen === 'boolean' ? forceOpen : this.els.drawer.classList.contains('hidden');
    this.els.drawer.classList.toggle('hidden', !open);
  }

  syncDom() {
    const ep = this.currentEpisode;
    if (!ep) return;
    const showInfo = SHOW_META[ep.show] || SHOW_META['Who ARTed'];
    const playing = !this.audio.paused && !this.audio.ended;
    const cur = this.pendingSeek !== null ? this.pendingSeek : (this.audio.currentTime || 0);
    const dur = Number.isFinite(this.audio.duration) && this.audio.duration > 0
      ? this.audio.duration
      : (ep.durationSec || 0);
    const cueStr = formatTime(ep.cueSeconds || 0);

    if (this.els.miniArt) this.els.miniArt.src = ep.artworkUrl || showInfo.cover;
    if (this.els.drawerArt) this.els.drawerArt.src = ep.artworkUrl || showInfo.cover;
    if (this.els.miniShow) this.els.miniShow.textContent = ep.show;
    if (this.els.drawerShow) this.els.drawerShow.textContent = `${ep.show} • ${ep.category}`;
    if (this.els.miniTitle) this.els.miniTitle.textContent = ep.title;
    if (this.els.drawerTitle) this.els.drawerTitle.textContent = ep.title;
    if (this.els.miniTime) this.els.miniTime.textContent = `${formatTime(cur)} / ${formatTime(dur)}`;
    if (this.els.drawerCurrent) this.els.drawerCurrent.textContent = formatTime(cur);
    if (this.els.drawerDuration) this.els.drawerDuration.textContent = formatTime(dur);

    const playGlyph = playing ? '⏸' : '▶';
    if (this.els.miniPlayBtn) this.els.miniPlayBtn.textContent = playGlyph;
    if (this.els.drawerPlayBtn) this.els.drawerPlayBtn.textContent = playing ? '⏸ Pause Clip' : '▶ Play Clip';
    if (this.els.miniCueBtn) this.els.miniCueBtn.textContent = `Cue ${cueStr}`;
    if (this.els.drawerCueBtn) this.els.drawerCueBtn.textContent = `⚡ Jump to Cue (${cueStr})`;
    if (this.els.drawerRateBtn) this.els.drawerRateBtn.textContent = `${this.rates[this.rateIndex]}x`;
    if (this.els.drawerSeek && dur > 0) {
      this.els.drawerSeek.value = String(Math.round((cur / dur) * 1000));
    }

    if (this.els.toast) {
      this.els.toast.textContent = this.lastError || '';
      this.els.toast.classList.toggle('hidden', !this.lastError);
    }
  }
}

export const audioPlayer = new PodcastAudioController();
