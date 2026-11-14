/**
 * Memphis-Styled PNG Scorecard Generator (Solo Mastery & Smartest Artists Podium)
 */
import { BADGE_DEFS } from './config.js';

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawMemphisBackdrop(ctx) {
  ctx.fillStyle = '#FFF8EE';
  ctx.fillRect(0, 0, 1080, 1080);

  // Subtle geometric accents inspired by Art Smart & Who ARTed covers
  ctx.fillStyle = '#FFE234';
  ctx.beginPath();
  ctx.arc(930, 140, 62, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = '#0D1554';
  ctx.stroke();

  ctx.fillStyle = '#53E2C5';
  ctx.beginPath();
  ctx.moveTo(90, 930);
  ctx.lineTo(175, 860);
  ctx.lineTo(195, 970);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#F59342';
  ctx.beginPath();
  ctx.arc(140, 150, 44, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Confetti dots
  const dots = [
    [220, 70, '#FF6E73'], [800, 920, '#45C5EE'], [980, 740, '#6261E8'], [90, 540, '#6AC420']
  ];
  dots.forEach(([cx, cy, col]) => {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(cx, cy, 14, 0, Math.PI * 2);
    ctx.fill();
  });
}

export function buildSoloScorecardDataUrl(state) {
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1080;
  const ctx = canvas.getContext('2d');
  drawMemphisBackdrop(ctx);

  // Hard offset shadow card
  ctx.fillStyle = '#0D1554';
  roundRect(ctx, 108, 128, 880, 840, 32);
  ctx.fill();

  ctx.fillStyle = '#FFFDF7';
  ctx.strokeStyle = '#0D1554';
  ctx.lineWidth = 8;
  roundRect(ctx, 92, 112, 880, 840, 32);
  ctx.fill();
  ctx.stroke();

  // Banner header
  ctx.fillStyle = '#FF6E73';
  roundRect(ctx, 130, 150, 804, 150, 22);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#FFFDF7';
  ctx.font = '800 56px "Fredoka", system-ui, sans-serif';
  ctx.fillText('ART SMART SCORECARD', 175, 225);
  ctx.fillStyle = '#0D1554';
  ctx.font = '700 28px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.fillText('FROM ART SMART & WHO ARTED PODCASTS', 175, 272);

  // Big Score pill
  ctx.fillStyle = '#FFE234';
  roundRect(ctx, 130, 338, 804, 180, 22);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#0D1554';
  ctx.font = '800 94px "Fredoka", system-ui, sans-serif';
  ctx.fillText(`${state.score.toLocaleString()} PTS`, 175, 448);
  ctx.font = '700 28px "Plus Jakarta Sans", system-ui, sans-serif';
  const acc = state.answeredCount ? Math.round((state.correctCount / state.answeredCount) * 100) : 0;
  ctx.fillText(`Accuracy: ${acc}% • Best Streak: ${state.bestStreak} • Bonus Solved: ${state.bonusCorrect}`, 175, 495);

  // Category bars
  const cats = [
    ['Elements of Art', '#FF6E73'],
    ['Principles of Design', '#6261E8'],
    ['Materials & Media', '#F59342'],
    ['Historical & Cultural Connections', '#45C5EE'],
    ['Fun Facts', '#6AC420']
  ];
  let y = 570;
  ctx.font = '700 26px "Plus Jakarta Sans", system-ui, sans-serif';
  cats.forEach(([cat, color]) => {
    const count = state.categoryCounts?.[cat] || 0;
    ctx.fillStyle = color;
    roundRect(ctx, 130, y, 42, 42, 10);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#0D1554';
    ctx.fillText(`${cat}: ${count} mastered`, 190, y + 30);
    y += 64;
  });

  ctx.fillStyle = '#0D1554';
  ctx.font = '700 24px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.fillText(`Badges Unlocked: ${state.unlockedBadges?.length || 0} / ${BADGE_DEFS.length}`, 130, 916);

  return canvas.toDataURL('image/png');
}

export function buildGroupPodiumDataUrl(room, topThree) {
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1080;
  const ctx = canvas.getContext('2d');
  drawMemphisBackdrop(ctx);

  ctx.fillStyle = '#0D1554';
  roundRect(ctx, 108, 128, 880, 840, 32);
  ctx.fill();

  ctx.fillStyle = '#FFFDF7';
  ctx.strokeStyle = '#0D1554';
  ctx.lineWidth = 8;
  roundRect(ctx, 92, 112, 880, 840, 32);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#6261E8';
  roundRect(ctx, 130, 150, 804, 155, 22);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#FFE234';
  ctx.font = '800 52px "Fredoka", system-ui, sans-serif';
  ctx.fillText('SMARTEST ARTISTS PODIUM', 175, 222);
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '700 28px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.fillText(`Room ${room.code} • ${Object.keys(room.players || {}).length} Artists Competed`, 175, 272);

  const medals = [
    { label: '1ST PLACE', bg: '#FFE234', y: 350 },
    { label: '2ND PLACE', bg: '#53E2C5', y: 530 },
    { label: '3RD PLACE', bg: '#FF6E73', y: 710 }
  ];

  medals.forEach((slot, idx) => {
    const player = topThree[idx];
    ctx.fillStyle = player ? slot.bg : '#F3EDE2';
    roundRect(ctx, 130, slot.y, 804, 145, 22);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = idx === 2 && player ? '#FFFFFF' : '#0D1554';
    ctx.font = '800 24px "Plus Jakarta Sans", system-ui, sans-serif';
    ctx.fillText(slot.label, 165, slot.y + 46);
    ctx.font = '800 48px "Fredoka", system-ui, sans-serif';
    ctx.fillText(player ? player.name : '— Open Spot —', 165, slot.y + 108);
    if (player) {
      const scoreText = `${player.score} pts`;
      const m = ctx.measureText(scoreText);
      ctx.fillText(scoreText, 895 - m.width, slot.y + 98);
    }
  });

  ctx.fillStyle = '#0D1554';
  ctx.font = '700 24px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.fillText('Art Smart & Who ARTed Group Edition', 130, 916);

  return canvas.toDataURL('image/png');
}
