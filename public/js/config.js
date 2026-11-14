/**
 * Art Smart Trivia Studio Configuration, Show Links, Educator Categories & Avatars
 */

export const SHOW_META = {
  'Art Smart': {
    name: 'Art Smart',
    shortLabel: 'Art Smart',
    cover: 'images/art-smart-cover.png',
    color: '#FF6E73',
    spotifyUrl: 'https://open.spotify.com/show/1S9SbkmRXtChPHxmlKfeZb',
    appleUrl: 'https://podcasts.apple.com/us/podcast/art-smart/id1603422346',
    rssUrl: 'https://feeds.megaphone.fm/ARML6383971331'
  },
  'Who ARTed': {
    name: 'Who ARTed',
    shortLabel: 'Who ARTed',
    cover: 'images/who-arted-cover.png',
    color: '#45C5EE',
    spotifyUrl: 'https://open.spotify.com/show/1Sv71dnatL79dprwfX4Ypa',
    appleUrl: 'https://podcasts.apple.com/us/podcast/who-arted-weekly-art-history-for-all-ages/id1485813093',
    rssUrl: 'https://feeds.megaphone.fm/ARML1644080429'
  }
};

export const CATEGORIES = [
  'All',
  'Elements of Art',
  'Principles of Design',
  'Materials & Media',
  'Historical & Cultural Connections',
  'Fun Facts'
];

export const CATEGORY_COLORS = {
  All: { bg: '#FFFDF7', text: '#0D1554', border: '#0D1554' },
  'Elements of Art': { bg: '#FF6E73', text: '#FFFFFF', border: '#0D1554' },
  'Principles of Design': { bg: '#6261E8', text: '#FFFFFF', border: '#0D1554' },
  'Materials & Media': { bg: '#F59342', text: '#0D1554', border: '#0D1554' },
  'Historical & Cultural Connections': { bg: '#45C5EE', text: '#0D1554', border: '#0D1554' },
  'Fun Facts': { bg: '#6AC420', text: '#0D1554', border: '#0D1554' }
};

export const CATEGORY_EMOJIS = {
  All: '✨',
  'Elements of Art': '🎨',
  'Principles of Design': '⚖️',
  'Materials & Media': '🏺',
  'Historical & Cultural Connections': '🏛️',
  'Fun Facts': '⚡'
};

export const SOLO_POINTS_PER_CORRECT = 100;
export const BONUS_POINTS_PER_CORRECT = 100;
export const GROUP_SPEED_TIERS = [100, 90, 80, 70, 60];
export const GROUP_DEFAULT_CORRECT_POINTS = 50;

export const OPTION_SHAPES = ['▲', '◆', '●', '■'];
export const OPTION_LETTERS = ['A', 'B', 'C', 'D'];

export const ARTIST_AVATARS = [
  { id: 'painter', emoji: '🎨', label: 'Painter', color: '#FF6E73' },
  { id: 'apple', emoji: '🍏', label: 'Surrealist', color: '#6AC420' },
  { id: 'potter', emoji: '🏺', label: 'Ceramicist', color: '#F59342' },
  { id: 'frame', emoji: '🖼️', label: 'Curator', color: '#45C5EE' },
  { id: 'pencil', emoji: '✏️', label: 'Sketcher', color: '#FFE234' },
  { id: 'sculpture', emoji: '🗿', label: 'Sculptor', color: '#6261E8' },
  { id: 'rainbow', emoji: '🌈', label: 'Colorist', color: '#53E2C5' },
  { id: 'camera', emoji: '📸', label: 'Photographer', color: '#F76E9A' },
  { id: 'theater', emoji: '🎭', label: 'Printmaker', color: '#19B5AE' },
  { id: 'star', emoji: '🌟', label: 'Visionary', color: '#F9DE59' },
  { id: 'owl', emoji: '🦉', label: 'Art Sleuth', color: '#45C5EE' },
  { id: 'butterfly', emoji: '🦋', label: 'Modernist', color: '#FF6E73' }
];

export const ROOM_EXPIRY_OPTIONS = [
  { key: '1h', label: '1 Hour', description: 'Quick 1-hour session' },
  { key: '1d', label: '1 Day', description: 'Same code all day' },
  { key: '1w', label: '1 Week', description: 'Reuse all week long' }
];

export const UNIT_STARTER_PACKS = [
  {
    id: 'starter-elements',
    title: 'Elements of Art Studio',
    subtitle: 'Line, shape, color, value, texture, space & form',
    filter: (ep) => ep.category === 'Elements of Art'
  },
  {
    id: 'starter-principles',
    title: 'Principles of Design Lab',
    subtitle: 'Balance, contrast, emphasis, rhythm, pattern & unity',
    filter: (ep) => ep.category === 'Principles of Design'
  },
  {
    id: 'starter-bell-ringers',
    title: 'Quick Warm-Ups (≤ 7 min)',
    subtitle: 'Ultra-short episodes ideal for lightning rounds',
    filter: (ep) => ep.durationSec <= 420
  },
  {
    id: 'starter-fun-facts',
    title: 'Kid-Favorite Fun Facts',
    subtitle: 'Art heists, wild pigments, and playful museum lore',
    filter: (ep) => ep.category === 'Fun Facts'
  },
  {
    id: 'starter-bonus-marathon',
    title: 'Bonus Deep-Dive Pack (20)',
    subtitle: 'Every question that unlocks a +100 bonus follow-up',
    filter: (ep) => Boolean(ep.bonusQuestion)
  }
];

export const BADGE_DEFS = [
  {
    id: 'first-stroke',
    title: 'First Brushstroke',
    icon: '🖌️',
    description: 'Answer your first Art Smart trivia question correctly.',
    check: (s) => s.correctCount >= 1
  },
  {
    id: 'bonus-scholar',
    title: 'Deep Dive Scholar',
    icon: '⚡',
    description: 'Nail a +100 Bonus Depth question.',
    check: (s) => s.bonusCorrect >= 1
  },
  {
    id: 'gallery-regular',
    title: 'Studio Regular',
    icon: '🏛️',
    description: 'Answer 10 questions correctly.',
    check: (s) => s.correctCount >= 10
  },
  {
    id: 'curator-25',
    title: 'Junior Curator',
    icon: '🖼️',
    description: 'Reach 2,500 Solo trivia points.',
    check: (s) => s.score >= 2500
  },
  {
    id: 'five-streak',
    title: 'Hot Palette Streak',
    icon: '🔥',
    description: 'Hit a 5-question accuracy streak.',
    check: (s) => s.bestStreak >= 5
  },
  {
    id: 'elements-ace',
    title: 'Elements Ace',
    icon: '🎨',
    description: 'Answer 5 Elements of Art questions correctly.',
    check: (s) => (s.categoryCounts?.['Elements of Art'] || 0) >= 5
  },
  {
    id: 'principles-pro',
    title: 'Design Architect',
    icon: '📐',
    description: 'Answer 5 Principles of Design questions correctly.',
    check: (s) => (s.categoryCounts?.['Principles of Design'] || 0) >= 5
  },
  {
    id: 'all-rounder',
    title: 'Museum All-Rounder',
    icon: '🌈',
    description: 'Score correctly across all 5 art categories.',
    check: (s) =>
      ['Elements of Art', 'Principles of Design', 'Materials & Media', 'Historical & Cultural Connections', 'Fun Facts'].every(
        (cat) => (s.categoryCounts?.[cat] || 0) >= 1
      )
  },
  {
    id: 'listener',
    title: 'Podcast Listener',
    icon: '🎧',
    description: 'Listen to 3 cued episode clips after answering.',
    check: (s) => (s.clipsListened || 0) >= 3
  },
  {
    id: 'classroom-competitor',
    title: 'Group Challenger',
    icon: '🏆',
    description: 'Join or host a Live Group Game.',
    check: (s) => (s.groupGamesPlayed || 0) >= 1
  },
  {
    id: 'smartest-artist',
    title: 'Smartest Artist',
    icon: '👑',
    description: 'Earn 25,000 points in Single Player trivia.',
    check: (s) => (s.score || 0) >= 25000
  }
];

/**
 * Optional Supabase Cloud Sync configuration for online multi-device rooms.
 * Leave url and anonKey empty to run seamlessly on Local Ruby Wi-Fi Server
 * or single-browser BroadcastChannel demo mode.
 */
export const CLOUD_CONFIG = {
  url: 'https://sffhjqpwwibxuuboggcc.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNmZmhqcXB3d2lieHV1Ym9nZ2NjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ1ODk4OTksImV4cCI6MjExMDE2NTg5OX0.EjUu_Y9x4B-iogAK8V6VJD1-AqOSfcoBWMnixfHif0Y'
};
