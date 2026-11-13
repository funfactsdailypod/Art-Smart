/**
 * Art Smart Trivia Studio — Main Application Controller
 * Connects the 250-episode catalog, instant-reveal Solo Quiz (+100 bonus challenges),
 * Embedded Cued Podcast Player, Unit Playlists, Live Classroom Arena, and Host Cue Studio.
 */
import {
  SHOW_META,
  CATEGORIES,
  CATEGORY_COLORS,
  CATEGORY_EMOJIS,
  OPTION_SHAPES,
  OPTION_LETTERS,
  ARTIST_AVATARS,
  UNIT_STARTER_PACKS,
  BADGE_DEFS
} from './config.js';
import { storage } from './storage.js';
import { audioPlayer, formatTime } from './audio-player.js';
import {
  arenaClient,
  generateSixDigitCode,
  sanitizeRoomCode,
  formatExpiryRemaining,
  getFullStandings,
  getTopSmartestArtists,
  buildStandingsCsv
} from './multiplayer.js';
import { renderQrSvg } from './qr.js';
import { sfx } from './sfx.js';
import { buildSoloScorecardDataUrl, buildGroupPodiumDataUrl } from './share-card.js';

const APP_STATE = {
  questions: [],
  questionMap: new Map(),
  soloFilter: {
    category: 'All',
    show: 'All',
    shortOnly: false,
    bonusOnly: false,
    playlistTitle: null,
    playlistGuids: null
  },
  soloFiltered: [],
  soloIndex: 0,
  libraryPage: 1,
  libraryPageSize: 18,
  pendingPlaylistGuid: null,
  hostConfig: {
    questionMode: 'random',
    questionCount: '10',
    expiryKey: '1d',
    pickedGuids: new Set()
  },
  selectedJoinAvatar: 'painter',
  clientId: getOrCreateClientId(),
  activeRoom: null,
  isHost: false,
  roomPollTimer: null,
  roomCountdownTimer: null,
  autoRevealingForIdx: -1,
  lanOriginUrl: null
};

function getOrCreateClientId() {
  const key = 'art_smart_client_id';
  let id = sessionStorage.getItem(key) || localStorage.getItem(key);
  if (!id) {
    id = `art-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    try {
      sessionStorage.setItem(key, id);
      localStorage.setItem(key, id);
    } catch {
      // Ignore storage errors
    }
  }
  return id;
}

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function parsePubDateMs(raw = '') {
  const ts = Date.parse(raw);
  return Number.isFinite(ts) ? ts : 0;
}

function formatPubDate(raw = '') {
  const ts = parsePubDateMs(raw);
  if (!ts) return String(raw || '');
  try {
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(
      new Date(ts)
    );
  } catch {
    return String(raw || '');
  }
}

function showToast(msg, durationMs = 2800) {
  const el = document.getElementById('appToast');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => el.classList.add('hidden'), durationMs);
}

function shuffleArray(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function launchConfetti(count = 48) {
  const canvas = document.getElementById('confettiCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  const colors = ['#FF6E73', '#FFE234', '#53E2C5', '#45C5EE', '#F59342', '#6261E8', '#6AC420'];
  const pieces = Array.from({ length: count }, () => ({
    x: Math.random() * canvas.width,
    y: -20 - Math.random() * 140,
    w: 8 + Math.random() * 8,
    h: 8 + Math.random() * 10,
    vx: (Math.random() - 0.5) * 6,
    vy: 3.2 + Math.random() * 4.5,
    rot: Math.random() * Math.PI * 2,
    vRot: (Math.random() - 0.5) * 0.25,
    color: colors[Math.floor(Math.random() * colors.length)]
  }));

  let frame = 0;
  function step() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let alive = false;
    for (const p of pieces) {
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vRot;
      if (p.y < canvas.height + 30) alive = true;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.strokeStyle = '#0D1554';
      ctx.lineWidth = 1.5;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.strokeRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    frame++;
    if (alive && frame < 145) requestAnimationFrame(step);
    else ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
  requestAnimationFrame(step);
}

/* ==================== CATALOG & OVERRIDES ==================== */
async function loadCatalog() {
  const res = await fetch('data/questions.json', { cache: 'no-store' });
  if (!res.ok) throw new Error('Unable to load Art Smart question catalog.');
  const rawList = await res.json();
  applyOverridesToCatalog(rawList);
}

function applyOverridesToCatalog(rawList) {
  const overrides = storage.getState().hostOverrides || {};
  APP_STATE.questions = rawList.map((ep) => {
    const ov = overrides[ep.guid];
    return ov ? { ...ep, ...ov } : ep;
  });
  APP_STATE.questionMap = new Map(APP_STATE.questions.map((ep) => [ep.guid, ep]));
  arenaClient.setQuestionMap(APP_STATE.questionMap);
  const libBadge = document.getElementById('navLibraryCount');
  if (libBadge) libBadge.textContent = String(APP_STATE.questions.length);
}

/* ==================== NAVIGATION & MODALS ==================== */
function switchTab(tabName) {
  document.querySelectorAll('.nav-tab').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.tab === tabName);
  });
  document.querySelectorAll('.tab-panel').forEach((panel) => {
    panel.classList.toggle('is-active', panel.id === `tab-${tabName}`);
  });
  if (tabName === 'episodes') renderLibrary();
  if (tabName === 'playlists') renderPlaylistsTab();
  if (tabName === 'group') renderSavedTeacherRooms();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function openModal(id) {
  document.getElementById(id)?.classList.remove('hidden');
}

function closeModal(id) {
  document.getElementById(id)?.classList.add('hidden');
}

function syncHeaderHud() {
  const st = storage.getState();
  const scoreEl = document.getElementById('hudScore');
  const streakEl = document.getElementById('hudStreak');
  const soundBtn = document.getElementById('soundToggleBtn');
  if (scoreEl) scoreEl.textContent = st.score.toLocaleString();
  if (streakEl) streakEl.textContent = `${st.streak} 🔥`;
  if (soundBtn) {
    soundBtn.textContent = st.settings.soundEnabled ? '🔊' : '🔇';
    soundBtn.setAttribute('aria-pressed', String(Boolean(st.settings.soundEnabled)));
  }

  const unlockedCount = st.unlockedBadges.length;
  const masteryEl = document.getElementById('soloMasterySummary');
  const masteryBar = document.getElementById('soloMasteryBar');
  const total = Math.max(1, APP_STATE.questions.length);
  const explored = st.answeredCount;
  if (masteryEl) {
    masteryEl.textContent = `${explored} / ${APP_STATE.questions.length} explored • ${unlockedCount}/10 badges`;
  }
  if (masteryBar) {
    masteryBar.style.width = `${Math.min(100, Math.round((explored / total) * 100))}%`;
  }
}

/* ==================== SOLO QUIZ FLOW ==================== */
function populateCategoryControls() {
  const soloBar = document.getElementById('soloCategoryBar');
  if (soloBar) {
    const counts = { All: APP_STATE.questions.length };
    APP_STATE.questions.forEach((ep) => {
      counts[ep.category] = (counts[ep.category] || 0) + 1;
    });
    soloBar.innerHTML = CATEGORIES.map((cat) => {
      const style = CATEGORY_COLORS[cat] || CATEGORY_COLORS.All;
      const emoji = CATEGORY_EMOJIS[cat] || '🎨';
      const active = APP_STATE.soloFilter.category === cat && !APP_STATE.soloFilter.playlistGuids ? 'is-active' : '';
      return `<button type="button" class="cat-filter-chip ${active}" data-solo-cat="${escapeHtml(cat)}"
        style="background:${style.bg};color:${style.text};">
        <span>${emoji}</span><span>${escapeHtml(cat)}</span><span>(${counts[cat] || 0})</span>
      </button>`;
    }).join('');
  }

  const selectIds = ['libraryCategorySelect', 'hostThemeCategory', 'hostPickerCatFilter'];
  selectIds.forEach((id) => {
    const sel = document.getElementById(id);
    if (!sel) return;
    sel.innerHTML = CATEGORIES.map((c) => `<option value="${escapeHtml(c)}">${c === 'All' ? 'All Categories' : escapeHtml(c)}</option>`).join('');
  });
}

function rebuildSoloFilteredDeck({ resetIndex = false } = {}) {
  const f = APP_STATE.soloFilter;
  if (Array.isArray(f.playlistGuids) && f.playlistGuids.length) {
    APP_STATE.soloFiltered = f.playlistGuids.map((g) => APP_STATE.questionMap.get(g)).filter(Boolean);
  } else {
    APP_STATE.soloFiltered = APP_STATE.questions.filter((ep) => {
      if (f.category !== 'All' && ep.category !== f.category) return false;
      if (f.show !== 'All' && ep.show !== f.show) return false;
      if (f.shortOnly && ep.durationSec > 420) return false;
      if (f.bonusOnly && !ep.bonusQuestion) return false;
      return true;
    });
  }
  if (resetIndex || APP_STATE.soloIndex >= APP_STATE.soloFiltered.length) {
    APP_STATE.soloIndex = 0;
  }
  renderSoloQuestionCard();
}

function getActiveSoloEpisode() {
  return APP_STATE.soloFiltered[APP_STATE.soloIndex] || null;
}

function renderSoloQuestionCard() {
  const ep = getActiveSoloEpisode();
  const promptEl = document.getElementById('soloQuestionPrompt');
  const gridEl = document.getElementById('soloOptionsGrid');
  const revealEl = document.getElementById('soloRevealPanel');
  const counterEl = document.getElementById('soloDeckCounter');

  if (!ep) {
    if (counterEl) counterEl.textContent = '0 / 0';
    if (promptEl) promptEl.textContent = 'No episodes match this filter combination. Try widening one filter.';
    if (gridEl) gridEl.innerHTML = '';
    revealEl?.classList.add('hidden');
    return;
  }

  const st = storage.getState();
  const answeredRec = st.answered[ep.guid];
  const isFav = storage.isFavorite(ep.guid);
  const showMeta = SHOW_META[ep.show] || SHOW_META['Who ARTed'];
  const catStyle = CATEGORY_COLORS[ep.category] || CATEGORY_COLORS.All;

  if (counterEl) {
    const deckTag = APP_STATE.soloFilter.playlistTitle ? `${APP_STATE.soloFilter.playlistTitle} · ` : '';
    counterEl.textContent = `${deckTag}Question ${APP_STATE.soloIndex + 1} of ${APP_STATE.soloFiltered.length}`;
  }

  const showBadge = document.getElementById('soloShowBadge');
  if (showBadge) {
    showBadge.textContent = ep.show;
    showBadge.classList.toggle('is-art-smart', ep.show === 'Art Smart');
  }
  const catBadge = document.getElementById('soloCategoryBadge');
  if (catBadge) {
    catBadge.textContent = `${CATEGORY_EMOJIS[ep.category] || '🎨'} ${ep.category}`;
    catBadge.style.background = catStyle.bg;
    catBadge.style.color = catStyle.text;
  }
  const durBadge = document.getElementById('soloDurationBadge');
  if (durBadge) durBadge.textContent = `⏱ ${formatTime(ep.durationSec)}`;

  document.getElementById('soloBonusFlagBadge')?.classList.toggle('hidden', !ep.bonusQuestion);

  const artImg = document.getElementById('soloArtwork');
  if (artImg) artImg.src = ep.artworkUrl || showMeta.cover;
  document.getElementById('soloPubDate').textContent = formatPubDate(ep.pubDate);
  document.getElementById('soloEpisodeTitle').textContent = ep.title;
  document.getElementById('soloStatusPill')?.classList.toggle('hidden', !answeredRec);

  const favBtn = document.getElementById('soloFavBtn');
  if (favBtn) favBtn.textContent = isFav ? '★ Saved' : '☆ Save';

  if (promptEl) promptEl.textContent = ep.question;

  if (gridEl) {
    gridEl.innerHTML = ep.options
      .map((opt, idx) => {
        let cls = 'option-btn';
        let disabled = '';
        if (answeredRec) {
          disabled = 'disabled';
          if (idx === ep.correctIndex) cls += ' is-correct';
          else if (idx === answeredRec.choice) cls += ' is-wrong';
          else cls += ' is-dimmed';
        }
        return `<button type="button" class="${cls}" data-opt-idx="${idx}" ${disabled}>
          <span class="option-shape-tag">${OPTION_SHAPES[idx]} ${OPTION_LETTERS[idx]}</span>
          <span>${escapeHtml(opt)}</span>
        </button>`;
      })
      .join('');
  }

  if (answeredRec) {
    renderSoloRevealState(ep, answeredRec);
  } else {
    revealEl?.classList.add('hidden');
  }
}

function handleSoloOptionClick(choiceIdx) {
  const ep = getActiveSoloEpisode();
  if (!ep) return;
  const st = storage.getState();
  if (st.answered[ep.guid]) return;

  const result = storage.recordSoloAnswer(ep, choiceIdx);
  if (result.isCorrect) {
    sfx.correct(st.settings.soundEnabled);
    launchConfetti(32);
  } else {
    sfx.wrong(st.settings.soundEnabled);
  }

  if (result.newlyUnlocked.length) {
    showToast(`🏅 Badge Unlocked: ${result.newlyUnlocked.map((b) => b.title).join(', ')}!`);
  }

  // Cue embedded player directly to episode insight timestamp!
  const autoPlay = Boolean(storage.getState().settings.autoCueOnReveal);
  audioPlayer.loadAndCue(ep, ep.cueSeconds || 0, autoPlay);
  if (autoPlay) storage.recordClipListened();

  syncHeaderHud();
  renderSoloQuestionCard();
}

function renderSoloRevealState(ep, answeredRec) {
  const revealEl = document.getElementById('soloRevealPanel');
  if (!revealEl) return;
  revealEl.classList.remove('hidden');

  const banner = document.getElementById('soloOutcomeBanner');
  banner.classList.toggle('is-correct', answeredRec.correct);
  banner.classList.toggle('is-wrong', !answeredRec.correct);

  document.getElementById('soloOutcomeIcon').textContent = answeredRec.correct ? '🎉' : '💡';
  document.getElementById('soloOutcomeHeading').textContent = answeredRec.correct
    ? '+100 Points! Spot On!'
    : `Answer: ${OPTION_LETTERS[ep.correctIndex]} — ${ep.options[ep.correctIndex]}`;
  document.getElementById('soloOutcomeSubtext').textContent = answeredRec.correct
    ? 'Nice art detective work — hit Play below to hear Kyle tell the story!'
    : 'Now you know! Listen to the cued episode clip below for the full backstory.';

  document.getElementById('soloExplanationText').textContent = ep.explanation;

  // Embedded Player setup for this episode
  const showMeta = SHOW_META[ep.show] || SHOW_META['Who ARTed'];
  const cueStr = formatTime(ep.cueSeconds || 0);
  document.getElementById('embeddedEpisodeHeading').textContent = `${ep.show}: ${ep.title}`;
  document.getElementById('embeddedCueBadge').textContent = `Cued @ ${cueStr}`;
  document.getElementById('embeddedCueNote').textContent = ep.cueVerified
    ? `Audio-verified insight timestamp (${cueStr} inside ${formatTime(ep.durationSec)} episode).`
    : `Smart-cued to ${cueStr} inside this ${formatTime(ep.durationSec)} episode — scrub anytime or fine-tune in Studio Settings.`;
  document.getElementById('embeddedSpotifyLink').href = ep.spotifyUrl || showMeta.spotifyUrl;
  document.getElementById('embeddedAppleLink').href = ep.appleUrl || showMeta.appleUrl;
  syncEmbeddedPlayerControls(audioPlayer.getSnapshot());

  // Bonus Depth Question Opportunity (8% of episodes)
  const bonusPanel = document.getElementById('soloBonusPanel');
  if (ep.bonusQuestion && bonusPanel) {
    bonusPanel.classList.remove('hidden');
    const bq = ep.bonusQuestion;
    const bChoice = answeredRec.bonusChoice;
    const bAnswered = typeof bChoice === 'number';
    document.getElementById('soloBonusStatusChip').textContent = bAnswered
      ? answeredRec.bonusCorrect
        ? '+100 Bonus Earned!'
        : 'Bonus Reviewed'
      : '+100 Extra Points Waiting';
    document.getElementById('soloBonusPrompt').textContent = bq.prompt;

    const bGrid = document.getElementById('soloBonusOptionsGrid');
    bGrid.innerHTML = bq.options
      .map((opt, idx) => {
        let cls = 'option-btn';
        let disabled = '';
        if (bAnswered) {
          disabled = 'disabled';
          if (idx === bq.correctIndex) cls += ' is-correct';
          else if (idx === bChoice) cls += ' is-wrong';
          else cls += ' is-dimmed';
        }
        return `<button type="button" class="${cls}" data-bonus-opt-idx="${idx}" ${disabled}>
          <span class="option-shape-tag">${OPTION_SHAPES[idx]} ${OPTION_LETTERS[idx]}</span>
          <span>${escapeHtml(opt)}</span>
        </button>`;
      })
      .join('');

    const bReveal = document.getElementById('soloBonusRevealBox');
    if (bAnswered) {
      bReveal.classList.remove('hidden');
      document.getElementById('soloBonusOutcomeTitle').textContent = answeredRec.bonusCorrect
        ? '⚡ +100 Bonus Points! Deeper Concept Nailed!'
        : `⚡ Deeper Insight: ${bq.options[bq.correctIndex]}`;
      document.getElementById('soloBonusExplanation').textContent = bq.explanation;
    } else {
      bReveal.classList.add('hidden');
    }
  } else {
    bonusPanel?.classList.add('hidden');
  }
}

function handleSoloBonusClick(bonusChoiceIdx) {
  const ep = getActiveSoloEpisode();
  if (!ep || !ep.bonusQuestion) return;
  const res = storage.recordBonusAnswer(ep, bonusChoiceIdx);
  const soundOn = storage.getState().settings.soundEnabled;
  if (res.isCorrect) {
    sfx.bonus(soundOn);
    launchConfetti(40);
  } else {
    sfx.wrong(soundOn);
  }
  if (res.newlyUnlocked.length) {
    showToast(`🏅 Badge Unlocked: ${res.newlyUnlocked.map((b) => b.title).join(', ')}!`);
  }
  syncHeaderHud();
  renderSoloQuestionCard();
}

function syncEmbeddedPlayerControls(snap) {
  const ep = getActiveSoloEpisode();
  const playBtn = document.getElementById('embeddedPlayCueBtn');
  const seekEl = document.getElementById('embeddedSeekRange');
  const curEl = document.getElementById('embeddedCurTime');
  const durEl = document.getElementById('embeddedDurTime');
  if (!ep || !playBtn) return;

  const isLoadedHere = snap.episode && snap.episode.guid === ep.guid;
  const dur = isLoadedHere ? snap.duration : ep.durationSec;
  const cur = isLoadedHere ? snap.currentTime : ep.cueSeconds || 0;

  playBtn.textContent = isLoadedHere && snap.isPlaying ? '⏸ Pause Clip' : `▶ Play from Cue (${formatTime(ep.cueSeconds || 0)})`;
  if (curEl) curEl.textContent = formatTime(cur);
  if (durEl) durEl.textContent = formatTime(dur);
  if (seekEl && dur > 0) {
    seekEl.value = String(Math.round((cur / dur) * 1000));
  }
}

function dealNextUnansweredSolo() {
  const answered = storage.getState().answered;
  const pool = APP_STATE.soloFiltered;
  if (!pool.length) return;
  const unansweredIndices = pool.map((ep, idx) => (!answered[ep.guid] ? idx : -1)).filter((i) => i !== -1);
  if (unansweredIndices.length > 0) {
    const pick = unansweredIndices[Math.floor(Math.random() * unansweredIndices.length)];
    APP_STATE.soloIndex = pick;
  } else {
    APP_STATE.soloIndex = Math.floor(Math.random() * pool.length);
  }
  renderSoloQuestionCard();
}

/* ==================== EPISODE LIBRARY ==================== */
function getFilteredLibraryList() {
  const q = (document.getElementById('librarySearchInput')?.value || '').trim().toLowerCase();
  const cat = document.getElementById('libraryCategorySelect')?.value || 'All';
  const show = document.getElementById('libraryShowSelect')?.value || 'All';
  const len = document.getElementById('libraryLengthSelect')?.value || 'all';
  const status = document.getElementById('libraryStatusSelect')?.value || 'all';
  const sort = document.getElementById('librarySortSelect')?.value || 'shortest';
  const st = storage.getState();

  const filtered = APP_STATE.questions.filter((ep) => {
    if (cat !== 'All' && ep.category !== cat) return false;
    if (show !== 'All' && ep.show !== show) return false;
    if (len === 'short' && ep.durationSec > 420) return false;
    if (len === 'medium' && ep.durationSec > 720) return false;
    if (status === 'unanswered' && st.answered[ep.guid]) return false;
    if (status === 'favorites' && !st.favorites.includes(ep.guid)) return false;
    if (status === 'bonus' && !ep.bonusQuestion) return false;
    if (q) {
      const hay = `${ep.title} ${ep.question} ${ep.explanation} ${ep.category}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  filtered.sort((a, b) => {
    if (sort === 'shortest') return a.durationSec - b.durationSec || parsePubDateMs(b.pubDate) - parsePubDateMs(a.pubDate);
    if (sort === 'newest') return parsePubDateMs(b.pubDate) - parsePubDateMs(a.pubDate);
    if (sort === 'oldest') return parsePubDateMs(a.pubDate) - parsePubDateMs(b.pubDate);
    return a.title.localeCompare(b.title);
  });

  return filtered;
}

function renderLibrary() {
  const list = getFilteredLibraryList();
  const countEl = document.getElementById('libraryResultCount');
  if (countEl) countEl.textContent = `Showing ${list.length} of ${APP_STATE.questions.length} episodes`;

  const totalPages = Math.max(1, Math.ceil(list.length / APP_STATE.libraryPageSize));
  if (APP_STATE.libraryPage > totalPages) APP_STATE.libraryPage = 1;
  const start = (APP_STATE.libraryPage - 1) * APP_STATE.libraryPageSize;
  const slice = list.slice(start, start + APP_STATE.libraryPageSize);

  const grid = document.getElementById('libraryCardsGrid');
  if (grid) {
    if (!slice.length) {
      grid.innerHTML = `<div class="memphis-card"><p>No episodes matched your filters.</p></div>`;
    } else {
      const st = storage.getState();
      grid.innerHTML = slice
        .map((ep) => {
          const isFav = st.favorites.includes(ep.guid);
          const ans = st.answered[ep.guid];
          const showClass = ep.show === 'Art Smart' ? 'is-art-smart' : '';
          return `<article class="episode-tile">
            <div>
              <div class="episode-tile-top">
                <img src="${escapeHtml(ep.artworkUrl || SHOW_META[ep.show]?.cover || '')}" alt="" class="episode-tile-art" loading="lazy" />
                <div>
                  <span class="show-badge ${showClass}">${escapeHtml(ep.show)}</span>
                  <span class="dur-badge">⏱ ${formatTime(ep.durationSec)}</span>
                  ${ep.bonusQuestion ? '<span class="bonus-flag-badge">⚡ +100 Bonus</span>' : ''}
                  ${ans ? '<span class="status-pill">✓ Played</span>' : ''}
                </div>
              </div>
              <h3 class="episode-tile-title">${escapeHtml(ep.title)}</h3>
              <p class="episode-tile-q">${escapeHtml(ep.question)}</p>
            </div>
            <div class="episode-tile-actions">
              <button type="button" class="btn btn-sm btn-coral" data-lib-play="${escapeHtml(ep.guid)}">▶ Quiz</button>
              <button type="button" class="btn btn-sm btn-mint" data-lib-listen="${escapeHtml(ep.guid)}">🎧 Cue ${formatTime(ep.cueSeconds)}</button>
              <button type="button" class="btn btn-sm btn-outline" data-lib-fav="${escapeHtml(ep.guid)}">${isFav ? '★' : '☆'}</button>
              <button type="button" class="btn btn-sm btn-outline" data-lib-pl="${escapeHtml(ep.guid)}">+ Playlist</button>
            </div>
          </article>`;
        })
        .join('');
    }
  }

  const pag = document.getElementById('libraryPagination');
  if (pag) {
    if (totalPages <= 1) {
      pag.innerHTML = '';
    } else {
      pag.innerHTML = `
        <button type="button" class="btn btn-sm btn-outline" id="libPrevPageBtn" ${APP_STATE.libraryPage <= 1 ? 'disabled' : ''}>← Prev</button>
        <span class="deck-counter">Page ${APP_STATE.libraryPage} of ${totalPages}</span>
        <button type="button" class="btn btn-sm btn-outline" id="libNextPageBtn" ${APP_STATE.libraryPage >= totalPages ? 'disabled' : ''}>Next →</button>
      `;
    }
  }
}

/* ==================== PLAYLISTS & STARTER PACKS ==================== */
function renderPlaylistsTab() {
  const packsGrid = document.getElementById('starterPacksGrid');
  if (packsGrid) {
    packsGrid.innerHTML = UNIT_STARTER_PACKS.map((pack) => {
      const count = APP_STATE.questions.filter(pack.filter).length;
      return `<article class="starter-pack-card">
        <div>
          <span class="eyebrow-tag">${count} Episodes</span>
          <h3>${escapeHtml(pack.title)}</h3>
          <p>${escapeHtml(pack.subtitle)}</p>
        </div>
        <div class="episode-tile-actions">
          <button type="button" class="btn btn-sm btn-coral" data-pack-solo="${pack.id}">▶ Solo</button>
          <button type="button" class="btn btn-sm btn-violet" data-pack-host="${pack.id}">🏟️ Classroom</button>
        </div>
      </article>`;
    }).join('');
  }

  const container = document.getElementById('customPlaylistsContainer');
  if (!container) return;
  const pls = storage.getState().playlists;
  if (!pls.length) {
    container.innerHTML = `<p class="empty-muted">No custom playlists yet. Create one above or click "+ Playlist" on any episode!</p>`;
    return;
  }

  container.innerHTML = pls
    .map((pl) => {
      const tracksHtml = pl.guids
        .map((guid, idx) => {
          const ep = APP_STATE.questionMap.get(guid);
          if (!ep) return '';
          return `<div class="playlist-track-item" draggable="true" data-pl-id="${escapeHtml(pl.id)}" data-track-idx="${idx}">
            <div>
              <strong>${idx + 1}. ${escapeHtml(ep.title)}</strong>
              <span class="dur-badge">${escapeHtml(ep.category)} · ${formatTime(ep.durationSec)}</span>
            </div>
            <button type="button" class="btn btn-sm btn-outline" data-pl-rem-track="${escapeHtml(pl.id)}" data-track-guid="${escapeHtml(guid)}">✕</button>
          </div>`;
        })
        .join('');

      return `<div class="custom-playlist-card">
        <div class="playlist-card-head">
          <div>
            <h3>${escapeHtml(pl.name)} (${pl.guids.length} episodes)</h3>
          </div>
          <div class="episode-tile-actions">
            <button type="button" class="btn btn-sm btn-coral" data-pl-solo="${escapeHtml(pl.id)}">▶ Play Solo</button>
            <button type="button" class="btn btn-sm btn-violet" data-pl-host="${escapeHtml(pl.id)}">🏟️ Launch Group</button>
            <button type="button" class="btn btn-sm btn-yellow" data-pl-share="${escapeHtml(pl.id)}">🔗 Share Link</button>
            <button type="button" class="btn btn-sm btn-outline" data-pl-del="${escapeHtml(pl.id)}">Delete</button>
          </div>
        </div>
        <div class="playlist-tracks-list">${tracksHtml || '<p class="empty-muted">Empty playlist — add questions from the Library tab.</p>'}</div>
      </div>`;
    })
    .join('');

  wirePlaylistDragDrop();
}

function wirePlaylistDragDrop() {
  let dragSrc = null;
  document.querySelectorAll('.playlist-track-item').forEach((row) => {
    row.addEventListener('dragstart', () => {
      dragSrc = { plId: row.dataset.plId, idx: Number(row.dataset.trackIdx) };
      row.classList.add('is-dragging');
    });
    row.addEventListener('dragend', () => row.classList.remove('is-dragging'));
    row.addEventListener('dragover', (e) => e.preventDefault());
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      if (!dragSrc) return;
      const targetPl = row.dataset.plId;
      const toIdx = Number(row.dataset.trackIdx);
      if (dragSrc.plId === targetPl && dragSrc.idx !== toIdx) {
        storage.reorderPlaylist(targetPl, dragSrc.idx, toIdx);
        renderPlaylistsTab();
      }
      dragSrc = null;
    });
  });
}

function openPlaylistPickerModal(guid) {
  APP_STATE.pendingPlaylistGuid = guid;
  const ep = APP_STATE.questionMap.get(guid);
  const body = document.getElementById('playlistPickerBody');
  if (!body || !ep) return;
  const pls = storage.getState().playlists;
  body.innerHTML = `
    <p><strong>${escapeHtml(ep.title)}</strong></p>
    <div class="field-group">
      ${
        pls.length
          ? pls
              .map(
                (pl) => `<button type="button" class="btn btn-outline full-width" style="margin-bottom:8px;justify-content:space-between;" data-pick-pl="${escapeHtml(pl.id)}">
                  <span>🗂️ ${escapeHtml(pl.name)}</span><span>${pl.guids.includes(guid) ? '✓ Added' : `${pl.guids.length} items`}</span>
                </button>`
              )
              .join('')
          : '<p class="section-sub">Create your first playlist below:</p>'
      }
    </div>
    <form id="modalQuickPlaylistForm" class="sync-row">
      <input id="modalQuickPlInput" type="text" class="text-input" maxlength="48" placeholder="New playlist name..." required />
      <button type="submit" class="btn btn-coral">Create &amp; Add</button>
    </form>
  `;
  openModal('playlistPickerModal');
}

/* ==================== CLASSROOM ARENA (GROUP MODE) ==================== */
function populateHostIndividualPicker() {
  const listEl = document.getElementById('hostPickerList');
  const countEl = document.getElementById('hostPickedCount');
  if (!listEl) return;
  const q = (document.getElementById('hostPickerSearch')?.value || '').trim().toLowerCase();
  const cat = document.getElementById('hostPickerCatFilter')?.value || 'All';

  const matches = APP_STATE.questions.filter((ep) => {
    if (cat !== 'All' && ep.category !== cat) return false;
    if (q) {
      const hay = `${ep.title} ${ep.question} ${ep.category}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  if (countEl) countEl.textContent = String(APP_STATE.hostConfig.pickedGuids.size);

  listEl.innerHTML = matches
    .slice(0, 80)
    .map((ep) => {
      const checked = APP_STATE.hostConfig.pickedGuids.has(ep.guid) ? 'checked' : '';
      return `<label class="picker-row">
        <input type="checkbox" data-picker-guid="${escapeHtml(ep.guid)}" ${checked} />
        <span class="picker-row-copy">
          <strong>${escapeHtml(ep.title)}</strong>
          <span>${escapeHtml(ep.category)} · ${formatTime(ep.durationSec)} — ${escapeHtml(ep.question.slice(0, 75))}...</span>
        </span>
      </label>`;
    })
    .join('');
}

function buildQuestionPoolForHostConfig(cfg, excludeGuids = new Set()) {
  let candidates = APP_STATE.questions;
  if (cfg.questionMode === 'theme') {
    candidates = candidates.filter((ep) => {
      if (cfg.theme && cfg.theme !== 'All' && ep.category !== cfg.theme) return false;
      if (cfg.showFilter && cfg.showFilter !== 'All' && ep.show !== cfg.showFilter) return false;
      return true;
    });
  } else if (cfg.questionMode === 'individual' && Array.isArray(cfg.customGuids) && cfg.customGuids.length) {
    return cfg.customGuids.filter((g) => !excludeGuids.has(g));
  }

  let fresh = candidates.filter((ep) => !excludeGuids.has(ep.guid));
  if (!fresh.length) fresh = candidates; // Wrap cleanly only if teacher exhausted all 250!
  return shuffleArray(fresh).map((ep) => ep.guid);
}

function populateJoinAvatarGrid() {
  const grid = document.getElementById('joinAvatarGrid');
  if (!grid) return;
  grid.innerHTML = ARTIST_AVATARS.map((av) => {
    const sel = av.id === APP_STATE.selectedJoinAvatar ? 'is-selected' : '';
    return `<button type="button" class="avatar-option-btn ${sel}" data-avatar-id="${av.id}">
      <span class="av-emoji">${av.emoji}</span>
      <span>${av.label}</span>
    </button>`;
  }).join('');
}

function renderSavedTeacherRooms() {
  const wrap = document.getElementById('savedTeacherRoomsSection');
  const list = document.getElementById('savedTeacherRoomsList');
  if (!wrap || !list) return;
  const now = Date.now();
  const activeSaved = (storage.getState().savedRooms || []).filter((r) => !r.expiresAt || Date.parse(r.expiresAt) > now);
  wrap.classList.toggle('hidden', activeSaved.length === 0);
  if (!activeSaved.length) return;

  list.innerHTML = activeSaved
    .map(
      (r) => `<div class="saved-room-row">
        <div>
          <strong>Code: ${escapeHtml(r.code)}</strong> · ${escapeHtml(r.title || 'Classroom Game')}
          <div class="meta-muted" style="font-size:0.78rem;">${formatExpiryRemaining(r.expiresAt)}</div>
        </div>
        <div class="episode-tile-actions">
          <button type="button" class="btn btn-sm btn-violet" data-reopen-room="${escapeHtml(r.code)}">Manage / Reset</button>
          <button type="button" class="btn btn-sm btn-outline" data-forget-room="${escapeHtml(r.code)}">✕</button>
        </div>
      </div>`
    )
    .join('');
}

async function handleCreateClassroomGame(e) {
  e.preventDefault();
  const mode = APP_STATE.hostConfig.questionMode;
  const theme = document.getElementById('hostThemeCategory')?.value || 'All';
  const showFilter = document.getElementById('hostThemeShow')?.value || 'All';
  const isEndless = APP_STATE.hostConfig.questionCount === 'endless';
  const requestedCount = isEndless ? 15 : Number(APP_STATE.hostConfig.questionCount) || 10;

  let questionGuids = [];
  if (mode === 'individual') {
    questionGuids = Array.from(APP_STATE.hostConfig.pickedGuids);
    if (!questionGuids.length) {
      showToast('Select at least 1 question (or switch to Random / Choose a Theme).');
      return;
    }
  } else {
    const pool = buildQuestionPoolForHostConfig({ questionMode: mode, theme, showFilter });
    if (!pool.length) {
      showToast('No questions found for that theme.');
      return;
    }
    questionGuids = pool.slice(0, Math.min(requestedCount, pool.length));
  }

  const hostName = document.getElementById('hostNameInput')?.value.trim() || 'Teacher';
  const title = document.getElementById('hostTitleInput')?.value.trim() || 'Art Smart Classroom Challenge';
  const customCode = sanitizeRoomCode(document.getElementById('hostRoomCodeInput')?.value) || generateSixDigitCode();
  const timerSec = Number(document.getElementById('hostTimerSelect')?.value ?? 25);

  try {
    const room = await arenaClient.createRoom({
      code: customCode,
      hostId: APP_STATE.clientId,
      hostName,
      title,
      questionMode: mode,
      theme,
      showFilter,
      questionCount: isEndless ? 'endless' : questionGuids.length,
      isEndless,
      questionGuids,
      pacing: timerSec === 0 ? 'manual' : 'timed',
      timerSec,
      expiryKey: APP_STATE.hostConfig.expiryKey
    });

    storage.saveTeacherRoom({
      code: room.code,
      title: room.title,
      expiresAt: room.expiresAt,
      expiryKey: room.expiryKey,
      questionMode: room.questionMode,
      theme: room.theme,
      showFilter: room.showFilter,
      isEndless: room.isEndless,
      questionCount: room.questionCount
    });
    storage.recordGroupGamePlayed();
    syncHeaderHud();

    enterActiveRoom(room, true);
    showToast(`Classroom Arena open! Share code ${room.code}`);
  } catch (err) {
    showToast(err.message || 'Could not create classroom room.');
  }
}

async function handleJoinClassroomGame(e) {
  e.preventDefault();
  const code = sanitizeRoomCode(document.getElementById('joinCodeInput')?.value);
  const name = document.getElementById('joinNameInput')?.value.trim();
  if (!code || !name) {
    showToast('Enter both the room code and your artist name.');
    return;
  }

  storage.updateSettings({ playerName: name, playerAvatar: APP_STATE.selectedJoinAvatar });
  try {
    const room = await arenaClient.joinRoom(code, {
      id: APP_STATE.clientId,
      name,
      avatar: APP_STATE.selectedJoinAvatar
    });
    storage.recordGroupGamePlayed();
    syncHeaderHud();
    enterActiveRoom(room, room.hostId === APP_STATE.clientId);
  } catch (err) {
    showToast(err.message || 'Could not join that classroom game.');
  }
}

function enterActiveRoom(room, isHost) {
  APP_STATE.activeRoom = room;
  APP_STATE.isHost = Boolean(isHost || room.hostId === APP_STATE.clientId);
  APP_STATE.autoRevealingForIdx = -1;

  document.getElementById('groupSetupView')?.classList.add('hidden');
  document.getElementById('groupRoomView')?.classList.remove('hidden');
  document.getElementById('navGroupLiveBadge')?.classList.remove('hidden');

  startRoomSyncLoops();
  renderActiveRoom();
}

function leaveActiveRoom() {
  stopRoomSyncLoops();
  APP_STATE.activeRoom = null;
  APP_STATE.isHost = false;
  document.getElementById('groupRoomView')?.classList.add('hidden');
  document.getElementById('groupSetupView')?.classList.remove('hidden');
  document.getElementById('navGroupLiveBadge')?.classList.add('hidden');
  renderSavedTeacherRooms();
}

function startRoomSyncLoops() {
  stopRoomSyncLoops();
  APP_STATE.roomPollTimer = setInterval(async () => {
    if (!APP_STATE.activeRoom) return;
    try {
      const fresh = await arenaClient.fetchRoom(APP_STATE.activeRoom.code);
      const prevStatus = APP_STATE.activeRoom.status;
      const prevIdx = APP_STATE.activeRoom.currentIndex;
      APP_STATE.activeRoom = fresh;
      if (fresh.status === 'ended' && prevStatus !== 'ended') {
        sfx.podium(storage.getState().settings.soundEnabled);
        launchConfetti(60);
      }
      if (prevIdx !== fresh.currentIndex) APP_STATE.autoRevealingForIdx = -1;
      renderActiveRoom();
    } catch {
      // Keep polling gracefully on transient hiccups
    }
  }, 1100);

  APP_STATE.roomCountdownTimer = setInterval(() => updateLiveRoomCountdown(), 200);
}

function stopRoomSyncLoops() {
  clearInterval(APP_STATE.roomPollTimer);
  clearInterval(APP_STATE.roomCountdownTimer);
}

function updateLiveRoomCountdown() {
  const room = APP_STATE.activeRoom;
  if (!room || room.status !== 'question') return;
  const timerText = document.getElementById('liveTimerText');
  const timerBar = document.getElementById('liveTimerBar');
  if (!room.timerSec || room.pacing === 'manual') {
    if (timerText) timerText.textContent = 'Untimed';
    if (timerBar) timerBar.style.width = '100%';
    return;
  }

  const elapsedSec = Math.max(0, (Date.now() - (room.questionStartedAtMs || Date.now())) / 1000);
  const remaining = Math.max(0, room.timerSec - elapsedSec);
  const pct = Math.max(0, Math.min(100, (remaining / room.timerSec) * 100));
  if (timerText) timerText.textContent = `${Math.ceil(remaining)}s`;
  if (timerBar) timerBar.style.width = `${pct}%`;

  // Auto-reveal when timer runs out on host
  if (APP_STATE.isHost && remaining <= 0 && APP_STATE.autoRevealingForIdx !== room.currentIndex) {
    APP_STATE.autoRevealingForIdx = room.currentIndex;
    hostRevealCurrentQuestion();
  }
}

function getAvatarEmoji(id) {
  return ARTIST_AVATARS.find((a) => a.id === id)?.emoji || '🎨';
}

function renderActiveRoom() {
  const room = APP_STATE.activeRoom;
  if (!room) return;

  document.getElementById('roomTitleTag').textContent = room.title || 'Art Smart Classroom Game';
  document.getElementById('activeRoomCode').textContent = room.code;
  document.getElementById('lobbyInlineCode').textContent = room.code;
  document.getElementById('resetSameCodeText').textContent = room.code;
  document.getElementById('activeRoomExpiryBadge').textContent = formatExpiryRemaining(room.expiresAt);

  const stageLobby = document.getElementById('roomStageLobby');
  const stageQuestion = document.getElementById('roomStageQuestion');
  const stageReveal = document.getElementById('roomStageReveal');
  const stageEnded = document.getElementById('roomStageEnded');

  [stageLobby, stageQuestion, stageReveal, stageEnded].forEach((el) => el?.classList.add('hidden'));

  const playersList = Object.values(room.players || {});
  const qIdx = room.currentIndex || 0;
  const currentGuid = room.questionGuids?.[qIdx];
  const ep = APP_STATE.questionMap.get(currentGuid);

  if (room.status === 'lobby') {
    stageLobby?.classList.remove('hidden');
    const base = APP_STATE.lanOriginUrl || window.location.origin;
    const joinUrl = `${base.replace(/\/$/, '')}/?join=${encodeURIComponent(room.code)}`;
    const qrBox = document.getElementById('roomQrContainer');
    if (qrBox && qrBox.dataset.lastUrl !== joinUrl) {
      qrBox.dataset.lastUrl = joinUrl;
      try {
        qrBox.innerHTML = renderQrSvg(joinUrl);
      } catch {
        qrBox.innerHTML = `<p class="empty-muted">${escapeHtml(joinUrl)}</p>`;
      }
    }

    document.getElementById('lobbyPlayerCount').textContent = String(playersList.length);
    document.getElementById('lobbyDeckSummary').textContent = room.isEndless
      ? '♾️ Endless Mode'
      : `${room.questionGuids?.length || 0} Questions`;

    const wall = document.getElementById('lobbyPlayersWall');
    if (wall) {
      wall.innerHTML = playersList.length
        ? playersList
            .map((p) => `<span class="player-chip">${getAvatarEmoji(p.avatar)} ${escapeHtml(p.name)}</span>`)
            .join('')
        : '<p class="empty-muted">Waiting for artists to join with their name &amp; avatar...</p>';
    }

    document.getElementById('hostLobbyControls')?.classList.toggle('hidden', !APP_STATE.isHost);
    document.getElementById('playerLobbyWaitMsg')?.classList.toggle('hidden', APP_STATE.isHost);
    return;
  }

  if (room.status === 'question' && ep) {
    stageQuestion?.classList.remove('hidden');
    const lockedCount = playersList.filter((p) => p.answers && p.answers[String(qIdx)]).length;

    // Auto-reveal once every joined player has locked in their answer
    if (
      APP_STATE.isHost &&
      playersList.length > 0 &&
      lockedCount >= playersList.length &&
      APP_STATE.autoRevealingForIdx !== qIdx
    ) {
      APP_STATE.autoRevealingForIdx = qIdx;
      setTimeout(() => hostRevealCurrentQuestion(), 350);
    }

    document.getElementById('liveQProgress').textContent = room.isEndless
      ? `Question ${qIdx + 1} • Endless Mode`
      : `Question ${qIdx + 1} of ${room.questionGuids.length}`;
    document.getElementById('liveQShowBadge').textContent = ep.show;
    document.getElementById('liveQShowBadge').classList.toggle('is-art-smart', ep.show === 'Art Smart');
    document.getElementById('liveQCatBadge').textContent = `${CATEGORY_EMOJIS[ep.category] || '🎨'} ${ep.category}`;
    document.getElementById('liveLockedCounter').textContent = `${lockedCount} / ${playersList.length} Locked In`;
    document.getElementById('liveEpisodeTitle').textContent = `${ep.title} (${formatTime(ep.durationSec)})`;
    document.getElementById('liveQuestionPrompt').textContent = ep.question;

    const myPlayer = room.players?.[APP_STATE.clientId];
    const myAns = myPlayer?.answers?.[String(qIdx)];
    const optGrid = document.getElementById('liveOptionsGrid');
    if (optGrid) {
      optGrid.innerHTML = ep.options
        .map((opt, idx) => {
          const picked = myAns && Number(myAns.choice) === idx;
          const disabled = myAns ? 'disabled' : '';
          return `<button type="button" class="option-btn ${picked ? 'is-selected' : ''}" data-live-opt="${idx}" ${disabled}
            style="${picked ? 'background:#FFF3D1;box-shadow:5px 5px 0 var(--violet);' : ''}">
            <span class="option-shape-tag">${OPTION_SHAPES[idx]} ${OPTION_LETTERS[idx]}</span>
            <span>${escapeHtml(opt)}</span>
          </button>`;
        })
        .join('');
    }

    document.getElementById('playerLockedStatus')?.classList.toggle('hidden', !myAns);
    document.getElementById('hostLiveControls')?.classList.toggle('hidden', !APP_STATE.isHost);
    updateLiveRoomCountdown();
    return;
  }

  if (room.status === 'reveal' && ep) {
    stageReveal?.classList.remove('hidden');
    document.getElementById('groupRevealCorrectText').textContent = `Answer: ${OPTION_LETTERS[ep.correctIndex]} — ${ep.options[ep.correctIndex]}`;
    document.getElementById('groupRevealExplanation').textContent = ep.explanation;
    document.getElementById('groupCueTimestampLabel').textContent = `Cue ${formatTime(ep.cueSeconds || 0)}`;

    const myAns = room.players?.[APP_STATE.clientId]?.answers?.[String(qIdx)];
    const awardPill = document.getElementById('playerRoundAwardPill');
    if (awardPill) {
      if (myAns) {
        awardPill.classList.remove('hidden');
        awardPill.classList.toggle('is-zero', !myAns.correct);
        awardPill.textContent = myAns.correct
          ? `${myAns.rank === 1 ? '🥇 1st!' : `#${myAns.rank}`} +${myAns.points} pts!`
          : '0 pts this round';
      } else {
        awardPill.classList.add('hidden');
      }
    }

    renderSmartestTop3(room, 'smartestTop3Podium');
    const standings = getFullStandings(room);
    const fullBox = document.getElementById('fullStandingsDrawer');
    if (fullBox) {
      fullBox.innerHTML = standings
        .map((p, i) => `<div class="standing-row"><span>#${i + 1} ${getAvatarEmoji(p.avatar)} ${escapeHtml(p.name)}</span><strong>${p.score} pts</strong></div>`)
        .join('');
    }

    const hostControls = document.getElementById('hostRevealControls');
    hostControls?.classList.toggle('hidden', !APP_STATE.isHost);
    const nextBtn = document.getElementById('hostNextQuestionBtn');
    if (nextBtn) {
      const hasMoreFixed = qIdx + 1 < (room.questionGuids?.length || 0);
      if (room.isEndless) nextBtn.textContent = 'Pull Next Random Question →';
      else if (hasMoreFixed) nextBtn.textContent = `Next Question (${qIdx + 2}/${room.questionGuids.length}) →`;
      else nextBtn.textContent = '🏆 Finish & Show Smartest Artists Podium';
    }
    return;
  }

  if (room.status === 'ended') {
    stageEnded?.classList.remove('hidden');
    document.getElementById('finalGameSummary').textContent = `${playersList.length} artist(s) competed across ${(room.currentIndex || 0) + 1} questions!`;
    renderSmartestTop3(room, 'finalTop3Grid');
    const standings = getFullStandings(room);
    const table = document.getElementById('finalFullTable');
    if (table) {
      table.innerHTML = standings
        .map(
          (p, i) => `<div class="standing-row">
            <span>#${i + 1} ${getAvatarEmoji(p.avatar)} ${escapeHtml(p.name)} <small>(${p.correctCount || 0} right)</small></span>
            <strong>${p.score} pts</strong>
          </div>`
        )
        .join('');
    }
    document.getElementById('hostEndedControls')?.classList.toggle('hidden', !APP_STATE.isHost);
  }
}

function renderSmartestTop3(room, containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const top3 = getTopSmartestArtists(room, 3);
  const medals = ['🥇 1st Place', '🥈 2nd Place', '🥉 3rd Place'];
  el.innerHTML = [0, 1, 2]
    .map((slotIdx) => {
      const p = top3[slotIdx];
      return `<div class="podium-slot rank-${slotIdx + 1}">
        <div class="podium-medal">${medals[slotIdx]}</div>
        <div class="podium-avatar">${p ? getAvatarEmoji(p.avatar) : '🎨'}</div>
        <strong class="podium-name">${p ? escapeHtml(p.name) : '—'}</strong>
        <span class="podium-score">${p ? `${p.score} pts` : '0 pts'}</span>
      </div>`;
    })
    .join('');
}

async function hostStartClassroomGame() {
  if (!APP_STATE.activeRoom) return;
  try {
    APP_STATE.activeRoom = await arenaClient.hostUpdateRoom(APP_STATE.activeRoom.code, {
      status: 'question',
      currentIndex: 0,
      questionStartedAtMs: Date.now()
    });
    renderActiveRoom();
  } catch (err) {
    showToast(err.message);
  }
}

async function hostRevealCurrentQuestion() {
  if (!APP_STATE.activeRoom || APP_STATE.activeRoom.status === 'reveal') return;
  try {
    APP_STATE.activeRoom = await arenaClient.hostUpdateRoom(APP_STATE.activeRoom.code, {
      status: 'reveal'
    });
    sfx.correct(storage.getState().settings.soundEnabled);
    renderActiveRoom();
  } catch (err) {
    showToast(err.message);
  }
}

async function hostAdvanceOrFinish() {
  const room = APP_STATE.activeRoom;
  if (!room) return;
  audioPlayer.pause();
  const nextIdx = (room.currentIndex || 0) + 1;

  if (room.isEndless) {
    // Expand deck dynamically whenever approaching end of buffered questions
    if (nextIdx >= room.questionGuids.length - 1) {
      const seen = new Set(room.questionGuids || []);
      const more = buildQuestionPoolForHostConfig(
        { questionMode: room.questionMode, theme: room.theme, showFilter: room.showFilter },
        seen
      ).slice(0, 12);
      try {
        APP_STATE.activeRoom = await arenaClient.appendEndlessQuestions(room.code, more, nextIdx, Date.now());
        renderActiveRoom();
        return;
      } catch (err) {
        showToast(err.message);
        return;
      }
    }
    try {
      APP_STATE.activeRoom = await arenaClient.hostUpdateRoom(room.code, {
        status: 'question',
        currentIndex: nextIdx,
        questionStartedAtMs: Date.now()
      });
      renderActiveRoom();
    } catch (err) {
      showToast(err.message);
    }
    return;
  }

  if (nextIdx >= (room.questionGuids?.length || 0)) {
    await hostFinishGameNow();
    return;
  }

  try {
    APP_STATE.activeRoom = await arenaClient.hostUpdateRoom(room.code, {
      status: 'question',
      currentIndex: nextIdx,
      questionStartedAtMs: Date.now()
    });
    renderActiveRoom();
  } catch (err) {
    showToast(err.message);
  }
}

async function hostFinishGameNow() {
  const room = APP_STATE.activeRoom;
  if (!room) return;
  audioPlayer.pause();
  try {
    APP_STATE.activeRoom = await arenaClient.hostUpdateRoom(room.code, { status: 'ended' });
    sfx.podium(storage.getState().settings.soundEnabled);
    launchConfetti(60);
    renderActiveRoom();
  } catch (err) {
    showToast(err.message);
  }
}

async function hostResetClassroomGame() {
  const room = APP_STATE.activeRoom;
  if (!room) return;
  const dealFresh = Boolean(document.getElementById('resetDealFreshCheck')?.checked);
  let newGuids = null;
  if (dealFresh) {
    const prevCount = room.isEndless ? 15 : room.questionGuids?.length || 10;
    const pool = buildQuestionPoolForHostConfig({
      questionMode: room.questionMode === 'individual' ? 'random' : room.questionMode,
      theme: room.theme,
      showFilter: room.showFilter
    });
    newGuids = pool.slice(0, Math.min(prevCount, pool.length));
  }

  try {
    APP_STATE.activeRoom = await arenaClient.resetRoomForNextClass(room.code, newGuids);
    APP_STATE.autoRevealingForIdx = -1;
    renderActiveRoom();
    showToast(`Game reset! Students can join room ${room.code} right away.`);
  } catch (err) {
    showToast(err.message);
  }
}

/* ==================== HOST CUE STUDIO & MODALS ==================== */
function populateHostStudioModal(preferredGuid = null) {
  const sel = document.getElementById('studioEpisodeSelect');
  if (!sel) return;
  sel.innerHTML = APP_STATE.questions
    .map((ep) => `<option value="${escapeHtml(ep.guid)}">${ep.cueVerified ? '✓ ' : ''}[${escapeHtml(ep.show)}] ${escapeHtml(ep.title)} (${formatTime(ep.cueSeconds)})</option>`)
    .join('');

  if (preferredGuid && APP_STATE.questionMap.has(preferredGuid)) sel.value = preferredGuid;
  loadStudioEpisodeFields();
}

function loadStudioEpisodeFields() {
  const guid = document.getElementById('studioEpisodeSelect')?.value;
  const ep = APP_STATE.questionMap.get(guid);
  if (!ep) return;
  document.getElementById('studioCueSecondsInput').value = String(ep.cueSeconds || 0);
  document.getElementById('studioQuestionInput').value = ep.question;
  document.getElementById('studioExplanationInput').value = ep.explanation;
}

function renderBadgesModal() {
  const body = document.getElementById('badgesModalBody');
  if (!body) return;
  const st = storage.getState();
  const acc = st.answeredCount ? Math.round((st.correctCount / st.answeredCount) * 100) : 0;
  body.innerHTML = `
    <p class="section-sub" style="margin-bottom:14px;">
      <strong>${st.score.toLocaleString()} pts</strong> • ${st.correctCount}/${st.answeredCount} correct (${acc}%) •
      Best Streak: ${st.bestStreak} • Bonus Deep Dives: ${st.bonusCorrect}/${st.bonusAttempted}
    </p>
    <div class="badges-grid">
      ${BADGE_DEFS.map((b) => {
        const unlocked = st.unlockedBadges.includes(b.id);
        return `<div class="badge-card ${unlocked ? 'is-unlocked' : ''}">
          <div class="badge-card-icon">${b.icon}</div>
          <strong>${escapeHtml(b.title)}</strong>
          <p style="margin:4px 0 0;font-size:0.8rem;">${escapeHtml(b.description)}</p>
        </div>`;
      }).join('')}
    </div>
  `;
}

function openScorecardModal(groupMode = false) {
  const img = document.getElementById('scorecardPreviewImg');
  const dlBtn = document.getElementById('downloadScorecardBtn');
  if (!img || !dlBtn) return;

  const dataUrl = groupMode && APP_STATE.activeRoom
    ? buildGroupPodiumDataUrl(APP_STATE.activeRoom, getTopSmartestArtists(APP_STATE.activeRoom, 3))
    : buildSoloScorecardDataUrl(storage.getState());
  img.src = dataUrl;
  dlBtn.dataset.imgUrl = dataUrl;
  openModal('scorecardModal');
}

/* ==================== EVENT WIRING ==================== */
function bindAllEvents() {
  // Primary tabs
  document.querySelectorAll('.nav-tab').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Header buttons
  document.getElementById('soundToggleBtn')?.addEventListener('click', () => {
    const cur = storage.getState().settings.soundEnabled;
    storage.updateSettings({ soundEnabled: !cur });
    syncHeaderHud();
  });

  document.getElementById('openBadgesBtn')?.addEventListener('click', () => {
    renderBadgesModal();
    openModal('badgesModal');
  });

  document.getElementById('openShareModalBtn')?.addEventListener('click', () => openScorecardModal(false));

  document.getElementById('openSettingsBtn')?.addEventListener('click', () => {
    const s = storage.getState().settings;
    document.getElementById('settingAutoCueCheck').checked = Boolean(s.autoCueOnReveal);
    document.getElementById('settingSoundCheck').checked = Boolean(s.soundEnabled);
    openModal('settingsModal');
  });

  // Modal closers
  document.querySelectorAll('[data-close-modal]').forEach((btn) => {
    btn.addEventListener('click', () => closeModal(btn.dataset.closeModal));
  });
  document.querySelectorAll('.modal-backdrop').forEach((backdrop) => {
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) backdrop.classList.add('hidden');
    });
  });

  // Solo Filter & Show Buttons
  document.querySelectorAll('[data-solo-show]').forEach((btn) => {
    btn.addEventListener('click', () => {
      APP_STATE.soloFilter.playlistGuids = null;
      APP_STATE.soloFilter.playlistTitle = null;
      APP_STATE.soloFilter.show = btn.dataset.soloShow;
      document.querySelectorAll('[data-solo-show]').forEach((b) => b.classList.toggle('is-active', b === btn));
      rebuildSoloFilteredDeck({ resetIndex: true });
    });
  });

  document.getElementById('soloShortToggleBtn')?.addEventListener('click', (e) => {
    APP_STATE.soloFilter.playlistGuids = null;
    APP_STATE.soloFilter.shortOnly = !APP_STATE.soloFilter.shortOnly;
    e.currentTarget.classList.toggle('is-active', APP_STATE.soloFilter.shortOnly);
    e.currentTarget.setAttribute('aria-pressed', String(APP_STATE.soloFilter.shortOnly));
    rebuildSoloFilteredDeck({ resetIndex: true });
  });

  document.getElementById('soloBonusOnlyBtn')?.addEventListener('click', (e) => {
    APP_STATE.soloFilter.playlistGuids = null;
    APP_STATE.soloFilter.bonusOnly = !APP_STATE.soloFilter.bonusOnly;
    e.currentTarget.classList.toggle('is-active', APP_STATE.soloFilter.bonusOnly);
    e.currentTarget.setAttribute('aria-pressed', String(APP_STATE.soloFilter.bonusOnly));
    rebuildSoloFilteredDeck({ resetIndex: true });
  });

  document.getElementById('soloCategoryBar')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-solo-cat]');
    if (!btn) return;
    APP_STATE.soloFilter.playlistGuids = null;
    APP_STATE.soloFilter.playlistTitle = null;
    APP_STATE.soloFilter.category = btn.dataset.soloCat;
    populateCategoryControls();
    rebuildSoloFilteredDeck({ resetIndex: true });
  });

  // Solo Question Navigation & Instant Choice
  document.getElementById('soloPrevBtn')?.addEventListener('click', () => {
    if (!APP_STATE.soloFiltered.length) return;
    APP_STATE.soloIndex = (APP_STATE.soloIndex - 1 + APP_STATE.soloFiltered.length) % APP_STATE.soloFiltered.length;
    renderSoloQuestionCard();
  });

  document.getElementById('soloNextBtn')?.addEventListener('click', () => {
    if (!APP_STATE.soloFiltered.length) return;
    APP_STATE.soloIndex = (APP_STATE.soloIndex + 1) % APP_STATE.soloFiltered.length;
    renderSoloQuestionCard();
  });

  document.getElementById('soloShuffleBtn')?.addEventListener('click', dealNextUnansweredSolo);
  document.getElementById('soloNextAfterRevealBtn')?.addEventListener('click', dealNextUnansweredSolo);

  document.getElementById('soloFavBtn')?.addEventListener('click', () => {
    const ep = getActiveSoloEpisode();
    if (!ep) return;
    const saved = storage.toggleFavorite(ep.guid);
    renderSoloQuestionCard();
    showToast(saved ? 'Saved to Favorites ★' : 'Removed from Favorites');
  });

  document.getElementById('soloAddPlBtn')?.addEventListener('click', () => {
    const ep = getActiveSoloEpisode();
    if (ep) openPlaylistPickerModal(ep.guid);
  });

  document.getElementById('soloOptionsGrid')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-opt-idx]');
    if (btn && !btn.disabled) handleSoloOptionClick(Number(btn.dataset.optIdx));
  });

  document.getElementById('soloBonusOptionsGrid')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-bonus-opt-idx]');
    if (btn && !btn.disabled) handleSoloBonusClick(Number(btn.dataset.bonusOptIdx));
  });

  // Inline Embedded Cued Player controls
  document.getElementById('embeddedPlayCueBtn')?.addEventListener('click', () => {
    const ep = getActiveSoloEpisode();
    if (!ep) return;
    const snap = audioPlayer.getSnapshot();
    if (snap.episode && snap.episode.guid === ep.guid) {
      audioPlayer.togglePlay();
    } else {
      audioPlayer.loadAndCue(ep, ep.cueSeconds || 0, true);
      storage.recordClipListened();
      syncHeaderHud();
    }
  });

  document.getElementById('embeddedBack15Btn')?.addEventListener('click', () => audioPlayer.nudge(-15));
  document.getElementById('embeddedFwd15Btn')?.addEventListener('click', () => audioPlayer.nudge(15));
  document.getElementById('embeddedSeekRange')?.addEventListener('input', (e) => {
    const ep = getActiveSoloEpisode();
    if (!ep) return;
    const dur = audioPlayer.getSnapshot().duration || ep.durationSec || 0;
    const targetSec = (Number(e.target.value) / 1000) * dur;
    const snap = audioPlayer.getSnapshot();
    if (!snap.episode || snap.episode.guid !== ep.guid) audioPlayer.loadAndCue(ep, targetSec, true);
    else audioPlayer.seekTo(targetSec);
  });

  // Episode Library controls
  ['librarySearchInput', 'libraryCategorySelect', 'libraryShowSelect', 'libraryLengthSelect', 'libraryStatusSelect', 'librarySortSelect'].forEach((id) => {
    document.getElementById(id)?.addEventListener(id === 'librarySearchInput' ? 'input' : 'change', () => {
      APP_STATE.libraryPage = 1;
      renderLibrary();
    });
  });

  document.getElementById('libraryCardsGrid')?.addEventListener('click', (e) => {
    const playBtn = e.target.closest('[data-lib-play]');
    if (playBtn) {
      const guid = playBtn.dataset.libPlay;
      APP_STATE.soloFilter = { category: 'All', show: 'All', shortOnly: false, bonusOnly: false, playlistTitle: null, playlistGuids: null };
      populateCategoryControls();
      rebuildSoloFilteredDeck({ resetIndex: true });
      const idx = APP_STATE.soloFiltered.findIndex((x) => x.guid === guid);
      if (idx !== -1) APP_STATE.soloIndex = idx;
      switchTab('solo');
      renderSoloQuestionCard();
      return;
    }

    const listenBtn = e.target.closest('[data-lib-listen]');
    if (listenBtn) {
      const ep = APP_STATE.questionMap.get(listenBtn.dataset.libListen);
      if (ep) {
        audioPlayer.loadAndCue(ep, ep.cueSeconds || 0, true);
        storage.recordClipListened();
        syncHeaderHud();
      }
      return;
    }

    const favBtn = e.target.closest('[data-lib-fav]');
    if (favBtn) {
      storage.toggleFavorite(favBtn.dataset.libFav);
      renderLibrary();
      return;
    }

    const plBtn = e.target.closest('[data-lib-pl]');
    if (plBtn) openPlaylistPickerModal(plBtn.dataset.libPl);
  });

  document.getElementById('libraryPagination')?.addEventListener('click', (e) => {
    if (e.target.id === 'libPrevPageBtn') {
      APP_STATE.libraryPage = Math.max(1, APP_STATE.libraryPage - 1);
      renderLibrary();
    } else if (e.target.id === 'libNextPageBtn') {
      APP_STATE.libraryPage += 1;
      renderLibrary();
    }
  });

  // Playlists & Starter Packs
  document.getElementById('createPlaylistForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('newPlaylistNameInput');
    if (storage.createPlaylist(input.value)) {
      input.value = '';
      renderPlaylistsTab();
      showToast('Created new unit playlist!');
    }
  });

  document.getElementById('starterPacksGrid')?.addEventListener('click', (e) => {
    const soloBtn = e.target.closest('[data-pack-solo]');
    if (soloBtn) {
      const pack = UNIT_STARTER_PACKS.find((p) => p.id === soloBtn.dataset.packSolo);
      if (!pack) return;
      APP_STATE.soloFilter.playlistTitle = pack.title;
      APP_STATE.soloFilter.playlistGuids = APP_STATE.questions.filter(pack.filter).map((ep) => ep.guid);
      rebuildSoloFilteredDeck({ resetIndex: true });
      switchTab('solo');
      return;
    }
    const hostBtn = e.target.closest('[data-pack-host]');
    if (hostBtn) {
      const pack = UNIT_STARTER_PACKS.find((p) => p.id === hostBtn.dataset.packSolo || p.id === hostBtn.dataset.packHost);
      if (!pack) return;
      const guids = APP_STATE.questions.filter(pack.filter).slice(0, 30).map((ep) => ep.guid);
      launchPlaylistIntoGroupSetup(pack.title, guids);
    }
  });

  document.getElementById('customPlaylistsContainer')?.addEventListener('click', (e) => {
    const soloBtn = e.target.closest('[data-pl-solo]');
    if (soloBtn) {
      const pl = storage.getState().playlists.find((p) => p.id === soloBtn.dataset.plSolo);
      if (!pl || !pl.guids.length) return showToast('Add episodes to this playlist first.');
      APP_STATE.soloFilter.playlistTitle = pl.name;
      APP_STATE.soloFilter.playlistGuids = [...pl.guids];
      rebuildSoloFilteredDeck({ resetIndex: true });
      switchTab('solo');
      return;
    }
    const hostBtn = e.target.closest('[data-pl-host]');
    if (hostBtn) {
      const pl = storage.getState().playlists.find((p) => p.id === hostBtn.dataset.plHost);
      if (!pl || !pl.guids.length) return showToast('Add episodes to this playlist first.');
      launchPlaylistIntoGroupSetup(pl.name, pl.guids);
      return;
    }
    const shareBtn = e.target.closest('[data-pl-share]');
    if (shareBtn) {
      const pl = storage.getState().playlists.find((p) => p.id === shareBtn.dataset.plShare);
      if (!pl) return;
      const encoded = encodeURIComponent(JSON.stringify({ n: pl.name, g: pl.guids }));
      const url = `${window.location.origin}${window.location.pathname}?playlist=${encoded}`;
      navigator.clipboard?.writeText(url).catch(() => {});
      showToast('Shareable playlist link copied to clipboard!');
      return;
    }
    const delBtn = e.target.closest('[data-pl-del]');
    if (delBtn) {
      storage.deletePlaylist(delBtn.dataset.plDel);
      renderPlaylistsTab();
      return;
    }
    const remTrack = e.target.closest('[data-pl-rem-track]');
    if (remTrack) {
      storage.removeFromPlaylist(remTrack.dataset.plRemTrack, remTrack.dataset.trackGuid);
      renderPlaylistsTab();
    }
  });

  document.getElementById('playlistPickerBody')?.addEventListener('click', (e) => {
    const pick = e.target.closest('[data-pick-pl]');
    if (pick && APP_STATE.pendingPlaylistGuid) {
      storage.addToPlaylist(pick.dataset.pickPl, APP_STATE.pendingPlaylistGuid);
      closeModal('playlistPickerModal');
      showToast('Added episode to playlist!');
    }
  });

  document.getElementById('playlistPickerBody')?.addEventListener('submit', (e) => {
    if (e.target.id === 'modalQuickPlaylistForm') {
      e.preventDefault();
      const inp = document.getElementById('modalQuickPlInput');
      const created = storage.createPlaylist(inp.value, APP_STATE.pendingPlaylistGuid ? [APP_STATE.pendingPlaylistGuid] : []);
      if (created) {
        closeModal('playlistPickerModal');
        showToast(`Saved to "${created.name}"!`);
      }
    }
  });

  // Group Host Config Controls
  document.getElementById('hostQuestionModeGroup')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-qmode]');
    if (!btn) return;
    APP_STATE.hostConfig.questionMode = btn.dataset.qmode;
    document.querySelectorAll('#hostQuestionModeGroup .seg-btn').forEach((b) => b.classList.toggle('is-active', b === btn));
    document.getElementById('hostThemeOptionsBox')?.classList.toggle('hidden', APP_STATE.hostConfig.questionMode !== 'theme');
    document.getElementById('hostIndividualPickerBox')?.classList.toggle('hidden', APP_STATE.hostConfig.questionMode !== 'individual');
    if (APP_STATE.hostConfig.questionMode === 'individual') populateHostIndividualPicker();
  });

  document.getElementById('hostPickerSearch')?.addEventListener('input', populateHostIndividualPicker);
  document.getElementById('hostPickerCatFilter')?.addEventListener('change', populateHostIndividualPicker);
  document.getElementById('hostPickerList')?.addEventListener('change', (e) => {
    const cb = e.target.closest('[data-picker-guid]');
    if (!cb) return;
    if (cb.checked) APP_STATE.hostConfig.pickedGuids.add(cb.dataset.pickerGuid);
    else APP_STATE.hostConfig.pickedGuids.delete(cb.dataset.pickerGuid);
    document.getElementById('hostPickedCount').textContent = String(APP_STATE.hostConfig.pickedGuids.size);
  });
  document.getElementById('hostPickerClearBtn')?.addEventListener('click', () => {
    APP_STATE.hostConfig.pickedGuids.clear();
    populateHostIndividualPicker();
  });

  document.getElementById('hostLengthPills')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-qcount]');
    if (!btn) return;
    APP_STATE.hostConfig.questionCount = btn.dataset.qcount;
    document.querySelectorAll('#hostLengthPills .seg-btn').forEach((b) => b.classList.toggle('is-active', b === btn));
    document.getElementById('hostEndlessHint')?.classList.toggle('hidden', btn.dataset.qcount !== 'endless');
  });

  document.getElementById('hostExpiryPills')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-expiry]');
    if (!btn) return;
    APP_STATE.hostConfig.expiryKey = btn.dataset.expiry;
    document.querySelectorAll('#hostExpiryPills .seg-btn').forEach((b) => b.classList.toggle('is-active', b === btn));
  });

  document.getElementById('hostRollCodeBtn')?.addEventListener('click', () => {
    document.getElementById('hostRoomCodeInput').value = generateSixDigitCode();
  });

  document.getElementById('hostCreateForm')?.addEventListener('submit', handleCreateClassroomGame);
  document.getElementById('playerJoinForm')?.addEventListener('submit', handleJoinClassroomGame);

  document.getElementById('joinAvatarGrid')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-avatar-id]');
    if (!btn) return;
    APP_STATE.selectedJoinAvatar = btn.dataset.avatarId;
    populateJoinAvatarGrid();
  });

  document.getElementById('savedTeacherRoomsList')?.addEventListener('click', async (e) => {
    const reopen = e.target.closest('[data-reopen-room]');
    if (reopen) {
      try {
        const room = await arenaClient.fetchRoom(reopen.dataset.reopenRoom);
        enterActiveRoom(room, true);
      } catch (err) {
        storage.removeTeacherRoom(reopen.dataset.reopenRoom);
        renderSavedTeacherRooms();
        showToast(err.message || 'That room has expired.');
      }
      return;
    }
    const forget = e.target.closest('[data-forget-room]');
    if (forget) {
      storage.removeTeacherRoom(forget.dataset.forgetRoom);
      renderSavedTeacherRooms();
    }
  });

  // Active Room Actions
  document.getElementById('copyRoomLinkBtn')?.addEventListener('click', () => {
    if (!APP_STATE.activeRoom) return;
    const base = APP_STATE.lanOriginUrl || window.location.origin;
    const url = `${base.replace(/\/$/, '')}/?join=${encodeURIComponent(APP_STATE.activeRoom.code)}`;
    navigator.clipboard?.writeText(url).catch(() => {});
    showToast(`Copied invite link for code ${APP_STATE.activeRoom.code}!`);
  });

  document.getElementById('leaveRoomBtn')?.addEventListener('click', leaveActiveRoom);
  document.getElementById('backToArenaLobbyBtn')?.addEventListener('click', leaveActiveRoom);
  document.getElementById('hostStartGameBtn')?.addEventListener('click', hostStartClassroomGame);
  document.getElementById('hostRevealBtn')?.addEventListener('click', hostRevealCurrentQuestion);
  document.getElementById('hostEndEarlyBtn')?.addEventListener('click', hostFinishGameNow);
  document.getElementById('hostNextQuestionBtn')?.addEventListener('click', hostAdvanceOrFinish);
  document.getElementById('hostFinishFromRevealBtn')?.addEventListener('click', hostFinishGameNow);
  document.getElementById('hostResetGameBtn')?.addEventListener('click', hostResetClassroomGame);

  document.getElementById('toggleFullStandingsBtn')?.addEventListener('click', () => {
    document.getElementById('fullStandingsDrawer')?.classList.toggle('hidden');
  });

  document.getElementById('groupPlayCueBtn')?.addEventListener('click', () => {
    const room = APP_STATE.activeRoom;
    const ep = room ? APP_STATE.questionMap.get(room.questionGuids?.[room.currentIndex || 0]) : null;
    if (ep) audioPlayer.loadAndCue(ep, ep.cueSeconds || 0, true);
  });

  document.getElementById('liveOptionsGrid')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-live-opt]');
    const room = APP_STATE.activeRoom;
    if (!btn || btn.disabled || !room || room.status !== 'question') return;
    try {
      APP_STATE.activeRoom = await arenaClient.submitAnswer(
        room.code,
        APP_STATE.clientId,
        room.currentIndex || 0,
        Number(btn.dataset.liveOpt)
      );
      sfx.tick(storage.getState().settings.soundEnabled);
      renderActiveRoom();
    } catch (err) {
      showToast(err.message);
    }
  });

  document.getElementById('exportCsvBtn')?.addEventListener('click', () => {
    if (!APP_STATE.activeRoom) return;
    const csv = buildStandingsCsv(APP_STATE.activeRoom);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `art-smart-room-${APP_STATE.activeRoom.code}.csv`;
    a.click();
  });

  document.getElementById('downloadGroupCardBtn')?.addEventListener('click', () => openScorecardModal(true));

  // Scorecard Download & Copy Caption
  document.getElementById('downloadScorecardBtn')?.addEventListener('click', (e) => {
    const url = e.currentTarget.dataset.imgUrl;
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = 'art-smart-scorecard.png';
    a.click();
  });

  document.getElementById('copyShareCaptionBtn')?.addEventListener('click', () => {
    const st = storage.getState();
    const caption = `I scored ${st.score.toLocaleString()} points on Art Smart Trivia (with ${st.bonusCorrect} Bonus Deep Dives solved)! Listen to Art Smart & Who ARTed by Kyle Wood.`;
    navigator.clipboard?.writeText(caption).catch(() => {});
    showToast('Share caption copied!');
  });

  // Settings & Host Studio
  document.getElementById('settingAutoCueCheck')?.addEventListener('change', (e) => {
    storage.updateSettings({ autoCueOnReveal: e.target.checked });
  });
  document.getElementById('settingSoundCheck')?.addEventListener('change', (e) => {
    storage.updateSettings({ soundEnabled: e.target.checked });
    syncHeaderHud();
  });

  document.getElementById('exportSyncBtn')?.addEventListener('click', () => {
    const code = storage.exportSyncCode();
    document.getElementById('syncCodeInput').value = code;
    navigator.clipboard?.writeText(code).catch(() => {});
    showToast('Sync code generated & copied!');
  });

  document.getElementById('importSyncBtn')?.addEventListener('click', () => {
    try {
      storage.importSyncCode(document.getElementById('syncCodeInput').value);
      syncHeaderHud();
      renderSoloQuestionCard();
      showToast('Progress imported!');
    } catch (err) {
      showToast(err.message);
    }
  });

  document.getElementById('resetSoloProgressBtn')?.addEventListener('click', () => {
    if (window.confirm('Reset all solo trivia scores, streaks, and answered history?')) {
      storage.resetAllProgress();
      syncHeaderHud();
      renderSoloQuestionCard();
      showToast('Solo stats reset.');
    }
  });

  document.getElementById('openHostStudioBtn')?.addEventListener('click', () => {
    closeModal('settingsModal');
    const current = getActiveSoloEpisode();
    populateHostStudioModal(current?.guid);
    openModal('hostStudioModal');
  });

  document.getElementById('studioEpisodeSelect')?.addEventListener('change', loadStudioEpisodeFields);

  document.getElementById('studioPlayEpisodeBtn')?.addEventListener('click', () => {
    const guid = document.getElementById('studioEpisodeSelect')?.value;
    const ep = APP_STATE.questionMap.get(guid);
    const cue = Number(document.getElementById('studioCueSecondsInput')?.value) || 0;
    if (ep) audioPlayer.loadAndCue(ep, cue, true);
  });

  document.getElementById('studioStampCueBtn')?.addEventListener('click', () => {
    const snap = audioPlayer.getSnapshot();
    const curSec = Math.round(snap.currentTime || 0);
    document.getElementById('studioCueSecondsInput').value = String(curSec);
    showToast(`Cue timestamp stamped at ${formatTime(curSec)} (${curSec}s)!`);
  });

  document.getElementById('studioSaveOverrideBtn')?.addEventListener('click', () => {
    const guid = document.getElementById('studioEpisodeSelect')?.value;
    if (!guid) return;
    storage.setHostOverride(guid, {
      cueSeconds: Math.max(0, Number(document.getElementById('studioCueSecondsInput')?.value) || 0),
      cueVerified: true,
      question: document.getElementById('studioQuestionInput')?.value.trim(),
      explanation: document.getElementById('studioExplanationInput')?.value.trim()
    });
    applyOverridesToCatalog(APP_STATE.questions);
    renderSoloQuestionCard();
    showToast('Saved local cue & question override!');
  });

  document.getElementById('studioDownloadJsonBtn')?.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(APP_STATE.questions, null, 2) + '\n'], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'questions.json';
    a.click();
    showToast('Downloaded updated questions.json!');
  });

  // Scroll top button visibility
  const scrollBtn = document.getElementById('scrollTopBtn');
  window.addEventListener('scroll', () => {
    scrollBtn?.classList.toggle('hidden', window.scrollY < 320);
  });
  scrollBtn?.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

  // BroadcastChannel instant multi-tab sync listener
  arenaClient.channel?.addEventListener('message', async (ev) => {
    if (ev.data?.type === 'room-update' && APP_STATE.activeRoom && ev.data.code === APP_STATE.activeRoom.code) {
      try {
        APP_STATE.activeRoom = await arenaClient.fetchRoom(APP_STATE.activeRoom.code);
        renderActiveRoom();
      } catch {
        // Ignore stale broadcasts
      }
    }
  });
}

function launchPlaylistIntoGroupSetup(title, guids) {
  switchTab('group');
  APP_STATE.hostConfig.questionMode = 'individual';
  APP_STATE.hostConfig.pickedGuids = new Set(guids);
  document.getElementById('hostTitleInput').value = title;
  document.querySelectorAll('#hostQuestionModeGroup .seg-btn').forEach((b) => {
    b.classList.toggle('is-active', b.dataset.qmode === 'individual');
  });
  document.getElementById('hostThemeOptionsBox')?.classList.add('hidden');
  document.getElementById('hostIndividualPickerBox')?.classList.remove('hidden');
  populateHostIndividualPicker();
  showToast(`Loaded "${title}" (${guids.length} questions) into Classroom Setup!`);
}

async function initApp() {
  audioPlayer.mountDom();
  audioPlayer.subscribe(syncEmbeddedPlayerControls);
  bindAllEvents();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  try {
    await loadCatalog();
  } catch (err) {
    document.getElementById('soloQuestionPrompt').textContent = err.message;
    return;
  }

  populateCategoryControls();
  populateJoinAvatarGrid();
  document.getElementById('hostRoomCodeInput').value = generateSixDigitCode();

  const savedSettings = storage.getState().settings;
  if (savedSettings.playerName) document.getElementById('joinNameInput').value = savedSettings.playerName;
  if (savedSettings.playerAvatar) {
    APP_STATE.selectedJoinAvatar = savedSettings.playerAvatar;
    populateJoinAvatarGrid();
  }

  rebuildSoloFilteredDeck({ resetIndex: true });
  syncHeaderHud();

  const backendInfo = await arenaClient.detectBackend();
  APP_STATE.lanOriginUrl = backendInfo.lanUrl;
  const connBanner = document.getElementById('arenaConnectionBanner');
  if (connBanner) {
    if (backendInfo.mode === 'supabase') {
      connBanner.textContent = '☁️ Online Cloud Sync Active — students can join from any network!';
    } else if (backendInfo.mode === 'local-server') {
      connBanner.textContent = `📡 Classroom Wi-Fi Server Active (${backendInfo.lanUrl || window.location.origin}) — multi-device ready!`;
    } else {
      connBanner.textContent = '💻 Single-Browser Demo Mode Active — start local Ruby server or add Supabase for multi-device rooms.';
    }
  }

  // Deep URL handling: ?join=123456 or ?playlist=...
  const params = new URLSearchParams(window.location.search);
  const joinParam = params.get('join');
  const plParam = params.get('playlist');

  if (joinParam) {
    document.getElementById('joinCodeInput').value = sanitizeRoomCode(joinParam);
    switchTab('group');
    showToast(`Enter your name & pick an avatar to join room ${sanitizeRoomCode(joinParam)}!`);
  } else if (plParam) {
    try {
      const parsed = JSON.parse(decodeURIComponent(plParam));
      if (parsed && Array.isArray(parsed.g) && parsed.g.length) {
        APP_STATE.soloFilter.playlistTitle = String(parsed.n || 'Shared Playlist');
        APP_STATE.soloFilter.playlistGuids = parsed.g;
        rebuildSoloFilteredDeck({ resetIndex: true });
        showToast(`Loaded shared playlist: ${APP_STATE.soloFilter.playlistTitle}`);
      }
    } catch {
      // Ignore malformed playlist share parameters
    }
  }
}

initApp();
