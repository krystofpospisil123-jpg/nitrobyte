// Sound: synthesized effects, a modelled engine (rpm + gears, blow-off valve, backfire pops) and an electronic music
// sequencer (drums, bass, pads, leads, reverb, delay, sidechain pumping). No audio files needed.
// Browsers only allow audio after a user gesture - the first key press / click unlocks it.

let ctx = null, master = null, musicBus = null, sfxBus = null, noiseBuf = null, verb = null;
const vol = { music: 3, sfx: 4, muted: false };      // music / sfx 0..5, set from the menu settings
let wantedSong = null;                                // song requested before audio was unlocked

function ac() {
  if (!ctx) {
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; }
    const comp = ctx.createDynamicsCompressor();       // glue + safety limiter on everything
    comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.2;
    comp.connect(ctx.destination);
    master = ctx.createGain(); master.connect(comp);
    musicBus = ctx.createGain(); musicBus.connect(master);
    sfxBus = ctx.createGain(); sfxBus.connect(master);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // reverb: convolution with 2.4 s of decaying stereo noise
    verb = ctx.createConvolver();
    const len = ctx.sampleRate * 2.4, ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const ch = ir.getChannelData(c); for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2); }
    verb.buffer = ir;
    const vg = ctx.createGain(); vg.gain.value = 0.55; verb.connect(vg).connect(musicBus);
    applyVolumes();
    if (wantedSong) { const s = wantedSong; wantedSong = null; music.play(s); }
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

const MUSIC_LEVEL = 0.42, SFX_LEVEL = 0.9;
function applyVolumes() {
  if (!ctx) return;
  const m = vol.muted ? 0 : 1;
  musicBus.gain.setTargetAtTime(m * (vol.music / 5) * MUSIC_LEVEL * (mus.ducked ? 0.3 : 1), ctx.currentTime, 0.08);
  sfxBus.gain.setTargetAtTime(m * (vol.sfx / 5) * SFX_LEVEL, ctx.currentTime, 0.05);
}

/** Set volumes (0..5) and mute from the menu. */
export function setVolumes({ music: mv, sfx: sv, muted } = {}) {
  if (mv !== undefined) vol.music = mv;
  if (sv !== undefined) vol.sfx = sv;
  if (muted !== undefined) vol.muted = muted;
  applyVolumes();
}
export const isMuted = () => vol.muted;

// ---------- building blocks ----------
const midi = m => 440 * Math.pow(2, (m - 69) / 12);

/** Oscillator with an attack / exponential decay envelope. */
function tone(freq, start, dur, type = 'sine', v = 0.05, dest = null, slideTo = null, attack = 0.004) {
  const a = ac(); if (!a) return;
  dest = dest || sfxBus;                                  // (sfxBus exists only after ac() created the context)
  const t0 = a.currentTime + start, o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t0);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(v, t0 + attack); g.gain.setTargetAtTime(0.0001, t0 + attack, dur / 4);
  o.connect(g).connect(dest); o.start(t0); o.stop(t0 + dur + 0.1);
}

/** Filtered noise burst. */
function noise(start, dur, v = 0.1, type = 'highpass', freq = 1000, dest = null, sweepTo = null, q = 0.8) {
  const a = ac(); if (!a) return;
  dest = dest || sfxBus;
  const t0 = a.currentTime + start, src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
  src.buffer = noiseBuf; src.loop = true; src.loopStart = Math.random();
  f.type = type; f.Q.value = q; f.frequency.setValueAtTime(freq, t0);
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(v, t0 + 0.003); g.gain.setTargetAtTime(0.0001, t0 + 0.003, dur / 4);
  src.connect(f).connect(g).connect(dest); src.start(t0, Math.random()); src.stop(t0 + dur + 0.1);
}

/** Bell / chime: sine + soft overtone. */
function bell(freq, start, dur = 0.5, v = 0.05) { tone(freq, start, dur, 'sine', v); tone(freq * 2.01, start, dur * 0.5, 'sine', v * 0.35); tone(freq * 3, start, dur * 0.25, 'triangle', v * 0.12); }

// ---------- sound effects ----------
export const sfx = {
  unlock() { ac(); },
  // menu: soft, glassy ticks instead of beeps
  select() { tone(1450, 0, 0.05, 'sine', 0.035, sfxBus, 1100); noise(0, 0.02, 0.02, 'highpass', 6000); },
  hover() { noise(0, 0.018, 0.022, 'highpass', 5200); tone(1800, 0, 0.025, 'sine', 0.012); },
  click() { tone(520, 0, 0.09, 'sine', 0.06, sfxBus, 780); tone(1560, 0.0, 0.06, 'sine', 0.02); noise(0, 0.03, 0.03, 'bandpass', 3000); },
  back() { tone(760, 0, 0.1, 'sine', 0.05, sfxBus, 420); noise(0, 0.03, 0.02, 'bandpass', 2000); },
  start() {                                                                // whoosh riser into an impact
    noise(0, 0.55, 0.12, 'bandpass', 300, sfxBus, 5000, 1.2);
    tone(110, 0, 0.6, 'sawtooth', 0.025, sfxBus, 440, 0.4);
    tone(70, 0.5, 0.5, 'sine', 0.22, sfxBus, 38); noise(0.5, 0.4, 0.12, 'lowpass', 1200);
    [523, 659, 784].forEach(f => tone(f, 0.5, 0.7, 'triangle', 0.025));
  },
  // economy
  coin(big = false) { bell(big ? 1568 : 1319, 0, 0.35, 0.05); bell(big ? 2093 : 1760, 0.06, 0.4, 0.04); },
  buy() { [1046, 1319, 1568, 2093].forEach((f, i) => bell(f, i * 0.07, 0.5, 0.045)); noise(0.2, 0.5, 0.03, 'highpass', 8000); },
  nope() { tone(150, 0, 0.12, 'square', 0.03); tone(130, 0.13, 0.16, 'square', 0.03); },
  reward() { [784, 988, 1175, 1568].forEach((f, i) => bell(f, i * 0.09, 0.6, 0.045)); },
  // race
  beep() { tone(660, 0, 0.3, 'sine', 0.09); tone(1320, 0, 0.15, 'sine', 0.02); },
  go() { [880, 1109, 1319].forEach(f => tone(f, 0, 0.8, 'sine', 0.06)); tone(1760, 0, 0.5, 'triangle', 0.02); noise(0, 0.4, 0.05, 'highpass', 5000); },
  boost() { noise(0, 0.7, 0.16, 'bandpass', 350, sfxBus, 3500, 1.5); tone(55, 0, 0.4, 'sine', 0.2, sfxBus, 35); this._whistle(1.2); },
  jump() { noise(0, 0.35, 0.06, 'bandpass', 600, sfxBus, 2200); },
  land() { tone(85, 0, 0.3, 'sine', 0.25, sfxBus, 38); noise(0, 0.2, 0.14, 'lowpass', 700); },
  wall() {
    noise(0, 0.25, 0.22, 'bandpass', 1400, sfxBus, 500, 1.5); tone(95, 0, 0.18, 'sine', 0.2, sfxBus, 50);
    tone(431, 0, 0.3, 'square', 0.015); tone(613, 0, 0.25, 'square', 0.012);                // metallic clang
  },
  finish() { [523, 659, 784, 1046].forEach((f, i) => bell(f, i * 0.1, 0.8, 0.05)); [523, 659, 784].forEach(f => tone(f, 0.45, 1.2, 'triangle', 0.03)); },

  // --- engine: rpm from speed and gear, 4-cylinder firing note through distortion and a load-dependent filter ---
  /** Call every frame with the player's car (or null / on=false to silence). */
  engine(car, on) {
    if (!on && !this._eng) return;                 // nothing to silence yet (and do not create the audio context early)
    const a = ac(); if (!a) return;
    if (!this._eng) this._eng = makeEngine(a);
    const e = this._eng, t = a.currentTime;
    if (!on || !car) { e.out.gain.setTargetAtTime(0, t, 0.08); e.rpm = 900; e.gear = 1; return; }

    const kmh = Math.abs(car.speed) * 3.6, thr = car.airborne ? (car.throttle || 0) : Math.max(car.throttle || 0, car.turboTime > 0 ? 1 : 0);
    // gearbox: each gear covers a speed range; shift up near the redline, down when the revs fall low
    const TOP = [0, 48, 82, 114, 145, 176, 230];
    let g = e.gear;
    const rpmIn = gg => 900 + (kmh / TOP[gg]) * 6600;
    if (rpmIn(g) > 7350 && g < 6) { g++; this._shift(thr); }
    while (g > 1 && rpmIn(g) < 3000) g--;
    e.gear = g;
    let want = Math.max(900, rpmIn(g));
    if (car.airborne) want = 900 + thr * 6600;                             // free-revving in the air
    else if (kmh < 25 && thr > 0) want = Math.max(want, 2600 + thr * 1800);     // clutch slip on launch
    if (car.turboTime > 0) want += 350;
    want = Math.min(7600, want);
    e.rpm += (want - e.rpm) * (want > e.rpm ? 0.25 : 0.12);
    e.load += (thr - e.load) * 0.15;

    const rpm = e.rpm, load = e.load, f0 = rpm / 30;                      // firing frequency of a 4-cylinder
    const k = 0.035;
    e.o1.frequency.setTargetAtTime(f0, t, k); e.o2.frequency.setTargetAtTime(f0 * 1.006, t, k);
    e.sub.frequency.setTargetAtTime(f0 / 2, t, k); e.hi.frequency.setTargetAtTime(f0 * 2, t, k);
    e.am.frequency.setTargetAtTime(f0 / 2, t, k);
    e.lp.frequency.setTargetAtTime(220 + rpm * 0.16 + load * 1600, t, 0.05);
    e.hiG.gain.setTargetAtTime(0.06 + load * 0.22, t, 0.05);
    e.intake.frequency.setTargetAtTime(700 + rpm * 0.35, t, 0.05);
    e.intakeG.gain.setTargetAtTime(0.006 + load * 0.03, t, 0.05);
    const spool = load * Math.max(0, Math.min(1, (rpm - 3200) / 3500));
    e.whistle.frequency.setTargetAtTime(2200 + rpm * 0.4, t, 0.1);
    e.whistleG.gain.setTargetAtTime(spool * 0.0045 + (car.turboTime > 0 ? 0.006 : 0), t, 0.15);
    const shiftCut = performance.now() < e.cutUntil ? 0.35 : 1;
    e.out.gain.setTargetAtTime((0.06 + load * 0.05 + rpm / 7600 * 0.03) * shiftCut, t, 0.03);
    // lifting off at high revs: the exhaust pops and crackles
    if (thr < 0.1 && e.prevThr >= 0.1 && rpm > 4200) this._pops(3 + Math.floor(Math.random() * 3));
    else if (thr < 0.1 && rpm > 4500 && Math.random() < 0.025) this._pops(1);
    e.prevThr = thr;
  },
  _shift(thr) {
    const e = this._eng; e.cutUntil = performance.now() + 110;
    if (thr > 0.5) { noise(0.02, 0.32, 0.05, 'highpass', 2500, sfxBus, 6000); tone(2600, 0.02, 0.15, 'sine', 0.008, sfxBus, 1800); }   // blow-off "pssh"
  },
  _pops(n) { for (let i = 0; i < n; i++) { const s = 0.04 + i * (0.05 + Math.random() * 0.08); noise(s, 0.06, 0.13, 'lowpass', 900 + Math.random() * 800); tone(70 + Math.random() * 30, s, 0.06, 'sine', 0.1, sfxBus, 40); } },
  _whistle(strength) { tone(3200, 0, 0.6, 'sine', 0.006 * strength, sfxBus, 4200, 0.2); },

  drift(on) {
    if (!on && !this._skid) return;
    const a = ac(); if (!a) return;
    if (!this._skid) {                                          // tyre screech: two resonant noise bands with a wobble
      const src = a.createBufferSource(), f1 = a.createBiquadFilter(), f2 = a.createBiquadFilter(), g = a.createGain(), lfo = a.createOscillator(), lg = a.createGain();
      src.buffer = noiseBuf; src.loop = true;
      f1.type = 'bandpass'; f1.frequency.value = 1900; f1.Q.value = 9;
      f2.type = 'bandpass'; f2.frequency.value = 3100; f2.Q.value = 7;
      lfo.frequency.value = 7; lg.gain.value = 140; lfo.connect(lg); lg.connect(f1.frequency); lg.connect(f2.frequency);
      g.gain.value = 0; src.connect(f1).connect(g); src.connect(f2).connect(g); g.connect(sfxBus); src.start(); lfo.start();
      this._skid = { g };
    }
    this._skid.g.gain.setTargetAtTime(on ? 0.22 : 0, a.currentTime, on ? 0.05 : 0.09);
  },
  silence() { this.engine(null, false); this.drift(false); },
};

function makeEngine(a) {
  const osc = (type, f) => { const o = a.createOscillator(); o.type = type; o.frequency.value = f; o.start(); return o; };
  const gain = v => { const g = a.createGain(); g.gain.value = v; return g; };
  const e = { rpm: 900, gear: 1, load: 0, prevThr: 0, cutUntil: 0 };
  e.o1 = osc('sawtooth', 30); e.o2 = osc('sawtooth', 30); e.sub = osc('square', 15); e.hi = osc('sawtooth', 60);
  const mix = gain(1), subG = gain(0.5); e.hiG = gain(0.1);
  e.o1.connect(mix); e.o2.connect(mix); e.sub.connect(subG).connect(mix); e.hi.connect(e.hiG).connect(mix);
  // soft distortion: the engine gets raspier when pushed
  const shaper = a.createWaveShaper(), curve = new Float32Array(1024);
  for (let i = 0; i < 1024; i++) { const x = i / 511.5 - 1; curve[i] = Math.tanh(2.6 * x); }
  shaper.curve = curve; shaper.oversample = '2x';
  e.lp = a.createBiquadFilter(); e.lp.type = 'lowpass'; e.lp.Q.value = 2.2;
  const body = a.createBiquadFilter(); body.type = 'peaking'; body.frequency.value = 140; body.gain.value = 6; body.Q.value = 1;
  // firing irregularity: amplitude wobble at half the firing rate
  const amG = gain(0.75); e.am = osc('sine', 15); const amDepth = gain(0.25); e.am.connect(amDepth).connect(amG.gain);
  e.out = gain(0);
  mix.connect(gain(0.35)).connect(shaper).connect(e.lp).connect(body).connect(amG).connect(e.out);
  // intake roar (filtered noise) and turbo whistle
  const nz = a.createBufferSource(); nz.buffer = noiseBuf; nz.loop = true; nz.start();
  e.intake = a.createBiquadFilter(); e.intake.type = 'bandpass'; e.intake.Q.value = 1.4; e.intakeG = gain(0);
  nz.connect(e.intake).connect(e.intakeG).connect(e.out);
  e.whistle = osc('sine', 2500); e.whistleG = gain(0); e.whistle.connect(e.whistleG).connect(sfxBus);
  e.out.connect(sfxBus);
  return e;
}

// ---------- music ----------
// Patterns are 16 steps per bar ('x' = hit, '-' = soft hit, '.' = rest). Chords: [bass root, pad voicing...] as MIDI notes.
// Arrangement repeats every 16 bars: intro (4) -> main (8) -> breakdown (2) -> build-up (2).
const SONGS = {
  menu: {   // night garage: laid-back, jazzy chords, dusty beat
    bpm: 86, swing: 0.16, sections: false,
    chords: [[45, 57, 60, 64, 67, 71], [41, 57, 60, 64, 69], [36, 55, 59, 64, 67], [43, 55, 59, 62, 66]],
    kick: 'x.....x...x.....', snare: '....x.......x...', hat: 'x.-.x.-.x.-.x.-.', ohat: '................',
    bass: { pat: 'x.........x.....', len: 6, cutoff: 500, type: 'sine' },
    pad: { v: 0.035, cutoff: 1400 },
    lead: { pat: '..x...x.....x.x.', notes: [0, 2, 4, 3], type: 'triangle', v: 0.035, oct: 12, delay: 0.35 },
  },
  city: {   // electro house, minor key, pumping sidechain
    bpm: 124, swing: 0, sections: true,
    chords: [[42, 54, 57, 61, 64], [38, 54, 57, 62, 66], [45, 57, 61, 64, 69], [40, 56, 59, 64, 68]],
    kick: 'x...x...x...x...', snare: '....x.......x...', hat: '--x---x---x---x-', ohat: '..x...x...x...x.',
    bass: { pat: '..x.x.x...x.x.xx', len: 1.6, cutoff: 900, type: 'reese' },
    pad: { v: 0.03, cutoff: 1800 },
    lead: { pat: 'x.xxx.x.x.xxx.x.', notes: [1, 2, 3, 4, 3, 2, 4, 1], type: 'sawtooth', v: 0.03, oct: 12, delay: 0.4 },
  },
  forest: { // drum & bass: fast breaks, rolling reese, airy pads
    bpm: 172, swing: 0, sections: true,
    chords: [[38, 50, 57, 62, 65], [34, 50, 58, 62, 65], [43, 55, 58, 62, 67], [45, 57, 61, 64, 69]],
    kick: 'x.........x.....', kick2: '..........x.x...', snare: '....x.......x...', hat: '-.x.-.x.-.x.-.xx', ohat: '......x.........',
    bass: { pat: 'x.......x.x.....', len: 7, cutoff: 600, type: 'reese', wobble: 0.6 },
    pad: { v: 0.04, cutoff: 2200 },
    lead: { pat: 'x.....x.....x...', notes: [4, 3, 2, 1], type: 'triangle', v: 0.035, oct: 24, delay: 0.5 },
  },
  desert: { // big beat: heavy groove, distorted riff
    bpm: 102, swing: 0.08, sections: true,
    chords: [[40, 52, 59, 64, 67], [36, 52, 55, 60, 64], [38, 50, 57, 62, 66], [35, 51, 54, 59, 63]],
    kick: 'x..x..x.x.......', snare: '....x.......x...', hat: 'x-x-x-x-x-x-x-x-', ohat: '..............x.',
    bass: { pat: 'x.xx..x.x.x..x.x', len: 1.4, cutoff: 1400, type: 'dist' },
    pad: { v: 0.025, cutoff: 1200 },
    lead: { pat: 'x..x..x...x.x...', notes: [1, 1, 2, 3, 2, 4], type: 'square', v: 0.025, oct: 12, delay: 0.3 },
  },
};

const mus = { song: null, name: null, step: 0, next: 0, timer: 0, out: null, duck: null, send: null, dly: null, ducked: false };

/** Which parts play in this bar (16-bar arrangement). */
function section(song, bar) {
  if (!song.sections) return { drums: true, bass: true, pad: true, lead: true, roll: false };
  const b = bar % 16;
  if (b < 4) return { drums: true, kickOnly: b < 2, bass: b >= 2, pad: true, lead: false };
  if (b < 12) return { drums: true, bass: true, pad: true, lead: true };
  if (b < 14) return { drums: false, bass: false, pad: true, lead: true };
  return { drums: false, roll: true, bass: b === 15, pad: true, lead: false, rise: true };
}

const hit = (pat, s) => pat && pat[s] !== '.' ? (pat[s] === 'x' ? 1 : 0.5) : 0;

function playStep(song, step, when) {
  const a = ctx, t = when, sd = 60 / song.bpm / 4;
  const bar = Math.floor(step / 16), s = step % 16, chord = song.chords[bar % song.chords.length];
  const sec = section(song, bar), out = mus.out, duck = mus.duck;

  // ---- drums ----
  if (sec.drums) {
    const kv = hit(song.kick, s) || hit(song.kick2, s) * 0.8;
    if (kv) kick(t, 0.9 * kv);
    if (!sec.kickOnly) {
      const sv = hit(song.snare, s); if (sv) snare(t, 0.32 * sv);
      const hv = hit(song.hat, s); if (hv) hat(t, 0.07 * hv, false);
      const ov = hit(song.ohat, s); if (ov) hat(t, 0.06 * ov, true);
    }
  }
  if (sec.roll) { const every = s < 8 ? 4 : s < 12 ? 2 : 1; if (s % every === 0) snare(t, 0.08 + 0.2 * (s / 16)); }
  if (sec.rise && s === 0) riser(t, sd * 32);

  // ---- bass ----
  if (sec.bass) {
    const bv = hit(song.bass.pat, s);
    if (bv) bass(t, chord[0] + (song.bass.type === 'dist' && s % 8 === 6 ? 7 : 0), sd * song.bass.len, 0.22 * bv, song.bass);
  }
  // ---- pad (once per bar) ----
  if (sec.pad && s === 0) pad(t, chord.slice(1), sd * 16, song.pad);
  // ---- lead / arp ----
  if (sec.lead && hit(song.lead.pat, s)) {
    const L = song.lead, idx = L.notes[(Math.floor(step / 2)) % L.notes.length] % (chord.length - 1);
    pluck(t, chord[1 + idx] + L.oct, sd * 1.8, L.v, L.type, L.delay);
  }
  // fill at the end of every 4th bar
  if (sec.drums && !sec.kickOnly && bar % 4 === 3 && s >= 13) hat(t, 0.05, false);

  function kick(t, v) {
    const o = a.createOscillator(), g = a.createGain();
    o.frequency.setValueAtTime(155, t); o.frequency.exponentialRampToValueAtTime(46, t + 0.11);
    g.gain.setValueAtTime(v, t); g.gain.setTargetAtTime(0.0001, t + 0.05, 0.09);
    o.connect(g).connect(out); o.start(t); o.stop(t + 0.6);
    nz(t, 0.012, v * 0.12, 'highpass', 3500, out);
    duck.gain.cancelScheduledValues(t); duck.gain.setValueAtTime(0.28, t); duck.gain.setTargetAtTime(1, t + 0.04, 0.08);    // sidechain pump
  }
  function snare(t, v) {
    nz(t, 0.2, v, 'bandpass', 1900, out, 0.7); nz(t, 0.2, v * 0.6, 'bandpass', 1900, mus.send, 0.7);
    const o = a.createOscillator(), g = a.createGain(); o.type = 'triangle'; o.frequency.setValueAtTime(200, t); o.frequency.exponentialRampToValueAtTime(150, t + 0.08);
    g.gain.setValueAtTime(v * 0.6, t); g.gain.setTargetAtTime(0.0001, t, 0.04); o.connect(g).connect(out); o.start(t); o.stop(t + 0.3);
  }
  function hat(t, v, open) { nz(t, open ? 0.28 : 0.045, v, 'highpass', open ? 7000 : 8500, out); }
  function riser(t, dur) {
    const src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
    src.buffer = noiseBuf; src.loop = true; f.type = 'bandpass'; f.Q.value = 2;
    f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(7000, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.09, t + dur); g.gain.linearRampToValueAtTime(0, t + dur + 0.05);
    src.connect(f).connect(g).connect(out); g.connect(mus.send); src.start(t); src.stop(t + dur + 0.1);
  }
  function bass(t, note, dur, v, B) {
    const f = a.createBiquadFilter(), g = a.createGain(), fr = midi(note);
    f.type = 'lowpass'; f.Q.value = B.type === 'dist' ? 2 : 5;
    f.frequency.setValueAtTime(B.cutoff * 3, t); f.frequency.setTargetAtTime(B.cutoff, t, 0.06);
    if (B.wobble) { const l = a.createOscillator(), lg = a.createGain(); l.frequency.value = song.bpm / 60 * 1.5; lg.gain.value = B.cutoff * B.wobble; l.connect(lg).connect(f.frequency); l.start(t); l.stop(t + dur + 0.2); }
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + 0.01); g.gain.setValueAtTime(v, t + dur * 0.8); g.gain.setTargetAtTime(0.0001, t + dur * 0.8, 0.05);
    const oscs = B.type === 'sine' ? [['sine', 0], ['triangle', 1200]] : [['sawtooth', -9], ['sawtooth', 9], ['sine', -1200]];
    let src = f;
    if (B.type === 'dist') { const sh = a.createWaveShaper(), c = new Float32Array(512); for (let i = 0; i < 512; i++) { const x = i / 255.5 - 1; c[i] = Math.tanh(4 * x); } sh.curve = c; sh.connect(f); src = sh; }
    for (const [type, cents] of oscs) {
      const o = a.createOscillator(), og = a.createGain(); o.type = type; o.frequency.value = fr; o.detune.value = cents;
      og.gain.value = type === 'sine' && cents < 0 ? 0.9 : 0.5; o.connect(og).connect(src); o.start(t); o.stop(t + dur + 0.3);
    }
    f.connect(g).connect(duck);
  }
  function pad(t, notes, dur, P) {
    const f = a.createBiquadFilter(), g = a.createGain();
    f.type = 'lowpass'; f.frequency.value = P.cutoff; f.Q.value = 0.5;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(P.v, t + dur * 0.25); g.gain.setValueAtTime(P.v, t + dur * 0.8); g.gain.linearRampToValueAtTime(0.0001, t + dur * 1.05);
    for (const n of notes) for (const cents of [-11, 11]) {
      const o = a.createOscillator(); o.type = 'sawtooth'; o.frequency.value = midi(n); o.detune.value = cents; o.connect(f); o.start(t); o.stop(t + dur * 1.1);
    }
    f.connect(g); g.connect(duck); g.connect(mus.send);
  }
  function pluck(t, note, dur, v, type, dly) {
    const o = a.createOscillator(), f = a.createBiquadFilter(), g = a.createGain();
    o.type = type; o.frequency.value = midi(note);
    f.type = 'lowpass'; f.Q.value = 3; f.frequency.setValueAtTime(5000, t); f.frequency.setTargetAtTime(700, t, 0.07);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + 0.005); g.gain.setTargetAtTime(0.0001, t + 0.01, dur / 3);
    o.connect(f).connect(g); g.connect(duck); g.connect(mus.send);
    if (dly) { const dg = a.createGain(); dg.gain.value = dly; g.connect(dg).connect(mus.dly); }
    o.start(t); o.stop(t + dur + 0.4);
  }
  function nz(t, dur, v, type, freq, dest, q = 0.8) {
    const src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
    src.buffer = noiseBuf; f.type = type; f.frequency.value = freq; f.Q.value = q;
    g.gain.setValueAtTime(v, t); g.gain.setTargetAtTime(0.0001, t + 0.002, dur / 4);
    src.connect(f).connect(g).connect(dest); src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.1);
  }
}

function schedule() {
  if (!ctx || !mus.song) return;
  const sd = 60 / mus.song.bpm / 4;
  if (mus.next < ctx.currentTime) mus.next = ctx.currentTime + 0.06;
  while (mus.next < ctx.currentTime + 0.25) {
    const swing = mus.step % 2 ? sd * (mus.song.swing || 0) : 0;
    playStep(mus.song, mus.step, mus.next + swing);
    mus.next += sd; mus.step++;
  }
}

export const music = {
  /** Start a song by name (menu / city / forest / desert). Restarts only when the song changes. */
  play(name) {
    if (name === 'downtown') name = 'city';
    if (!SONGS[name]) name = 'menu';
    if (!ctx) { wantedSong = name; return; }          // audio not unlocked yet: starts on the first key press
    if (mus.name === name) return;
    this.stop();
    const song = SONGS[name];
    mus.name = name; mus.song = song; mus.step = 0; mus.next = 0;
    mus.out = ctx.createGain(); mus.out.gain.value = 0; mus.out.gain.setTargetAtTime(1, ctx.currentTime, 0.3); mus.out.connect(musicBus);
    mus.duck = ctx.createGain(); mus.duck.connect(mus.out);                       // bass / pads / leads pump with the kick
    mus.send = ctx.createGain(); mus.send.gain.value = 0.35; mus.send.connect(verb);
    // tempo-synced delay (dotted eighth) with damped feedback
    const d = ctx.createDelay(2), fb = ctx.createGain(), damp = ctx.createBiquadFilter();
    d.delayTime.value = (60 / song.bpm) * 0.75; fb.gain.value = 0.38; damp.type = 'lowpass'; damp.frequency.value = 2400;
    mus.dly = ctx.createGain(); mus.dly.connect(d); d.connect(damp).connect(fb).connect(d); damp.connect(mus.out);
    mus.dlyNodes = [d, fb, damp];
    schedule(); mus.timer = setInterval(schedule, 40);
  },
  stop() {
    clearInterval(mus.timer);
    if (mus.out) {
      const nodes = [mus.out, mus.duck, mus.send, mus.dly, ...(mus.dlyNodes || [])];
      mus.out.gain.setTargetAtTime(0, ctx.currentTime, 0.15);
      setTimeout(() => nodes.forEach(n => { try { n.disconnect(); } catch {} }), 900);
    }
    mus.song = null; mus.name = null; mus.out = null;
  },
  /** Lower the music while paused. */
  duck(on) { mus.ducked = on; applyVolumes(); },
};

/** For debugging / level checks only. */
export const _audioDebug = () => ({ ctx, master });

addEventListener('keydown', () => sfx.unlock(), { once: true });
addEventListener('pointerdown', () => sfx.unlock(), { once: true });
