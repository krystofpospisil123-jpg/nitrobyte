// Sound: synthesized sound effects, engine, and a small chiptune music sequencer (Web Audio).
// No audio files needed. Browsers only allow audio after a user gesture - the first key press / click unlocks it.

let ctx = null, master = null, musicBus = null, sfxBus = null, noiseBuf = null;
const vol = { music: 3, sfx: 4, muted: false };      // music / sfx 0..5, set from the menu settings
let wantedSong = null;                                // song requested before audio was unlocked

function ac() {
  if (!ctx) {
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; }
    master = ctx.createGain(); master.connect(ctx.destination);
    musicBus = ctx.createGain(); musicBus.connect(master);
    sfxBus = ctx.createGain(); sfxBus.connect(master);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    applyVolumes();
    if (wantedSong) { const s = wantedSong; wantedSong = null; music.play(s); }
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

function applyVolumes() {
  if (!ctx) return;
  const m = vol.muted ? 0 : 1;
  musicBus.gain.setTargetAtTime(m * (vol.music / 5) * 0.32, ctx.currentTime, 0.05);
  sfxBus.gain.setTargetAtTime(m * (vol.sfx / 5) * 0.9, ctx.currentTime, 0.05);
}

/** Set volumes (0..5) and mute from the menu. */
export function setVolumes({ music, sfx, muted } = {}) {
  if (music !== undefined) vol.music = music;
  if (sfx !== undefined) vol.sfx = sfx;
  if (muted !== undefined) vol.muted = muted;
  applyVolumes();
}
export const isMuted = () => vol.muted;

// ---------- building blocks ----------
function tone(freq, start, dur, type = 'square', v = 0.05, dest = sfxBus, slideTo = null) {
  const a = ac(); if (!a) return;
  const t0 = a.currentTime + start, o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t0);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(v, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(dest); o.start(t0); o.stop(t0 + dur + 0.02);
}

function noise(start, dur, v = 0.1, filterType = 'highpass', freq = 1000, dest = sfxBus, sweepTo = null) {
  const a = ac(); if (!a) return;
  const t0 = a.currentTime + start, src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
  src.buffer = noiseBuf; src.loop = true;
  f.type = filterType; f.frequency.setValueAtTime(freq, t0);
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t0 + dur);
  g.gain.setValueAtTime(v, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f).connect(g).connect(dest); src.start(t0); src.stop(t0 + dur + 0.02);
}

// ---------- sound effects ----------
export const sfx = {
  unlock() { ac(); },
  // menu
  select() { tone(520, 0, 0.05, 'square', 0.03); },
  hover() { tone(740, 0, 0.03, 'triangle', 0.02); },
  click() { tone(660, 0, 0.05, 'square', 0.05); tone(990, 0.05, 0.08, 'square', 0.04); },
  back() { tone(440, 0, 0.06, 'square', 0.04); tone(330, 0.06, 0.09, 'square', 0.04); },
  start() { [392, 523, 659, 784].forEach((f, i) => tone(f, i * 0.06, 0.14, 'square', 0.05)); },
  // economy
  coin(big = false) { tone(big ? 1319 : 988, 0, 0.07); tone(big ? 1976 : 1319, 0.06, 0.14); },
  buy() { tone(660, 0, 0.08); tone(880, 0.08, 0.08); tone(1320, 0.16, 0.2); },
  nope() { tone(180, 0, 0.18, 'sawtooth', 0.06); },
  reward() { [523, 659, 784, 1046].forEach((f, i) => tone(f, i * 0.09, 0.16)); },
  // race
  beep() { tone(440, 0, 0.18, 'square', 0.06); },
  go() { tone(880, 0, 0.5, 'square', 0.07); tone(1320, 0, 0.5, 'triangle', 0.04); },
  boost() { noise(0, 0.55, 0.16, 'bandpass', 500, sfxBus, 3200); tone(220, 0, 0.4, 'sawtooth', 0.04, sfxBus, 660); },
  jump() { tone(300, 0, 0.25, 'triangle', 0.06, sfxBus, 700); },
  land() { noise(0, 0.18, 0.2, 'lowpass', 600); tone(90, 0, 0.18, 'sine', 0.12, sfxBus, 45); },
  wall() { noise(0, 0.2, 0.2, 'bandpass', 1800, sfxBus, 400); tone(110, 0, 0.15, 'square', 0.05, sfxBus, 60); },
  finish() { [523, 659, 784, 1046, 784, 1046, 1318].forEach((f, i) => tone(f, i * 0.1, 0.2, 'square', 0.05)); },

  // --- continuous: engine and tyre screech ---
  /** Call every frame with the player's car (or null to silence). */
  engine(car, on) {
    if (!on && !this._eng) return;                 // nothing to silence yet (and do not create the audio context early)
    const a = ac(); if (!a) return;
    if (!this._eng) {
      const o1 = a.createOscillator(), o2 = a.createOscillator(), f = a.createBiquadFilter(), g = a.createGain();
      o1.type = 'sawtooth'; o2.type = 'square'; f.type = 'lowpass'; f.frequency.value = 700; g.gain.value = 0;
      o1.connect(f); o2.connect(f); f.connect(g).connect(sfxBus); o1.start(); o2.start();
      this._eng = { o1, o2, f, g };
    }
    const e = this._eng, t = a.currentTime;
    if (!on || !car) { e.g.gain.setTargetAtTime(0, t, 0.08); return; }
    const kmh = Math.abs(car.speed) * 3.6, gear = Math.min(5, Math.floor(kmh / 38)), inGear = (kmh % 38) / 38;   // rev up, drop at each gear shift
    const base = 58 + gear * 18 + inGear * 95 + (car.turboTime > 0 ? 25 : 0);
    e.o1.frequency.setTargetAtTime(base, t, 0.04); e.o2.frequency.setTargetAtTime(base * 0.5, t, 0.04);
    e.f.frequency.setTargetAtTime(500 + kmh * 9, t, 0.08);
    e.g.gain.setTargetAtTime(car.airborne ? 0.035 : 0.05 + Math.min(0.05, kmh / 3000), t, 0.06);
  },
  drift(on) {
    if (!on && !this._skid) return;
    const a = ac(); if (!a) return;
    if (!this._skid) {
      const src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
      src.buffer = noiseBuf; src.loop = true; f.type = 'bandpass'; f.frequency.value = 2400; f.Q.value = 1.4; g.gain.value = 0;
      src.connect(f).connect(g).connect(sfxBus); src.start();
      this._skid = { g };
    }
    this._skid.g.gain.setTargetAtTime(on ? 0.07 : 0, a.currentTime, 0.04);
  },
  silence() { this.engine(null, false); this.drift(false); },
};

// ---------- music: a tiny chiptune sequencer ----------
// Each song: bpm, chord progression (one chord per bar), bass / arp / drum patterns (16 steps per bar).
const SONGS = {
  menu: {   // relaxed, dreamy
    bpm: 92, chords: [[57, 'm'], [53, 'M'], [60, 'M'], [55, 'M']],
    bass: [0, 6, 8, 14], arp: [0, -1, 1, -1, 2, -1, 1, -1, 0, -1, 2, -1, 4, -1, 2, -1], lead: 'triangle', pad: true,
    kick: [0, 8], snare: [], hat: [4, 12], vol: 0.8,
  },
  city: {   // night-drive synthwave
    bpm: 126, chords: [[40, 'm'], [36, 'M'], [43, 'M'], [38, 'M']],
    bass: [0, 2, 3, 6, 8, 10, 11, 14], arp: [3, 4, 5, 4, 3, 4, 5, 6, 3, 4, 5, 4, 5, 4, 3, 2], lead: 'square', pad: true,
    kick: [0, 4, 8, 12], snare: [4, 12], hat: [2, 6, 10, 14], vol: 1,
  },
  forest: { // bright and bouncy
    bpm: 118, chords: [[48, 'M'], [43, 'M'], [45, 'm'], [41, 'M']],
    bass: [0, 3, 6, 8, 11, 14], arp: [3, 5, 4, 5, 3, 5, 4, 2, 3, 5, 4, 5, 6, 5, 4, 3], lead: 'triangle', pad: false,
    kick: [0, 6, 8, 14], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], vol: 1,
  },
  desert: { // dusty stomp
    bpm: 108, chords: [[38, 'm'], [39, 'M'], [36, 'M'], [38, 'm']],
    bass: [0, 3, 4, 8, 11, 12], arp: [3, -1, 5, 3, -1, 4, 3, -1, 3, -1, 5, 3, 6, 5, 4, -1], lead: 'sawtooth', pad: true,
    kick: [0, 3, 8, 10], snare: [4, 12], hat: [2, 6, 10, 14], vol: 0.9,
  },
};

const mus = { song: null, name: null, step: 0, next: 0, timer: 0, gain: null };

function note(m) { return 440 * Math.pow(2, (m - 69) / 12); }

function playStep(song, step, when) {
  const a = ctx, bar = Math.floor(step / 16) % song.chords.length, s = step % 16;
  const [root, kind] = song.chords[bar], tones = [root, root + (kind === 'm' ? 3 : 4), root + 7];
  const stepDur = 60 / song.bpm / 4, dest = mus.gain, off = when - a.currentTime;
  const v = song.vol;
  if (song.kick.includes(s)) tone(130, off, 0.16, 'sine', 0.5 * v, dest, 40);
  if (song.snare.includes(s)) noise(off, 0.13, 0.22 * v, 'highpass', 1500, dest);
  if (song.hat.includes(s)) noise(off, 0.04, 0.09 * v, 'highpass', 7000, dest);
  if (song.bass.includes(s)) tone(note(root - 12 + (s % 4 === 3 ? 12 : 0)), off, stepDur * 1.6, 'sawtooth', 0.2 * v, dest);
  const ai = song.arp[s];
  if (ai >= 0) tone(note(tones[ai % 3] + 12 * (1 + Math.floor(ai / 3))), off, stepDur * 1.3, song.lead, 0.11 * v, dest);
  if (song.pad && s === 0) for (const t of tones) tone(note(t + 12), off, stepDur * 15, 'triangle', 0.06 * v, dest);
  if (bar === song.chords.length - 1 && s >= 12 && s % 2 === 0) noise(off, 0.05, 0.1 * v, 'highpass', 4000, dest);     // small fill at the end of the loop
}

function schedule() {
  if (!ctx || !mus.song) return;
  const stepDur = 60 / mus.song.bpm / 4;
  if (mus.next < ctx.currentTime) mus.next = ctx.currentTime + 0.05;
  while (mus.next < ctx.currentTime + 0.3) { playStep(mus.song, mus.step, mus.next); mus.next += stepDur; mus.step++; }
}

export const music = {
  /** Start a song by name (menu / city / forest / desert). Restarts only when the song changes. */
  play(name) {
    if (!SONGS[name]) name = 'menu';
    if (!ctx) { wantedSong = name; return; }          // audio not unlocked yet: starts on the first key press
    if (mus.name === name) return;
    this.stop();
    mus.name = name; mus.song = SONGS[name]; mus.step = 0; mus.next = 0;
    mus.gain = ctx.createGain(); mus.gain.gain.value = 1; mus.gain.connect(musicBus);
    schedule(); mus.timer = setInterval(schedule, 40);
  },
  stop() {
    clearInterval(mus.timer);
    if (mus.gain) { const g = mus.gain; g.gain.setTargetAtTime(0, ctx.currentTime, 0.1); setTimeout(() => g.disconnect(), 600); }
    mus.song = null; mus.name = null; mus.gain = null;
  },
  /** Lower the music while paused. */
  duck(on) { if (musicBus) musicBus.gain.setTargetAtTime(on ? 0.25 * (vol.music / 5) * 0.32 : (vol.muted ? 0 : (vol.music / 5) * 0.32), ctx.currentTime, 0.1); },
};

addEventListener('keydown', () => sfx.unlock(), { once: true });
addEventListener('pointerdown', () => sfx.unlock(), { once: true });
