/**
 * Lightweight Web Audio Synthesizer for Classroom & Solo Quiz Feedback
 * Zero external audio assets required; respects user's sound toggle.
 */

let audioCtx = null;

function getCtx() {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (Ctor) audioCtx = new Ctor();
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

function playTone(freq, duration = 0.12, type = 'triangle', gainVal = 0.14, delay = 0) {
  const ctx = getCtx();
  if (!ctx) return;

  const now = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, now);

  gain.gain.setValueAtTime(0.001, now);
  gain.gain.exponentialRampToValueAtTime(gainVal, now + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + duration + 0.02);
}

export const sfx = {
  correct(enabled = true) {
    if (!enabled) return;
    playTone(523.25, 0.12, 'triangle', 0.15, 0);
    playTone(659.25, 0.13, 'triangle', 0.15, 0.08);
    playTone(783.99, 0.22, 'triangle', 0.16, 0.16);
  },
  wrong(enabled = true) {
    if (!enabled) return;
    playTone(260, 0.15, 'sawtooth', 0.08, 0);
    playTone(196, 0.22, 'sawtooth', 0.08, 0.12);
  },
  bonus(enabled = true) {
    if (!enabled) return;
    playTone(587.33, 0.11, 'sine', 0.15, 0);
    playTone(739.99, 0.11, 'sine', 0.15, 0.07);
    playTone(880.0, 0.13, 'sine', 0.16, 0.14);
    playTone(1174.66, 0.26, 'triangle', 0.16, 0.22);
  },
  tick(enabled = true) {
    if (!enabled) return;
    playTone(880, 0.04, 'sine', 0.05, 0);
  },
  podium(enabled = true) {
    if (!enabled) return;
    [523.25, 659.25, 783.99, 1046.5].forEach((freq, idx) => {
      playTone(freq, 0.22, 'triangle', 0.14, idx * 0.09);
    });
  }
};
