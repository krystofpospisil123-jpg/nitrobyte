// Bot driver brain: follows the track with a racing line, brakes for corners, drifts, uses turbo,
// grabs boost pads and gets harder with the difficulty preset (see CONFIG.difficulties).
// Same interface as the other controllers: getInput(now, driver) -> input.
import { CONFIG } from './config.js';
import { NEUTRAL_INPUT } from './drivers.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrapAngle = a => Math.atan2(Math.sin(a), Math.cos(a));

export class BotController {
  /**
   * preset: one entry of CONFIG.difficulties ({ value, speed, corner, line, mistakes, ... })
   * skill: small per-bot multiplier (~0.97..1.03) so bots are not identical
   */
  constructor(track, preset = CONFIG.difficulties[2], skill = 1) {
    this.track = track;
    this.preset = preset;
    this.difficulty = preset.value;
    this.skill = skill;
    this.seed = Math.random() * 1000;   // makes every bot wander differently
    this.mistake = 0;                   // current "mistake" steering offset, decays over time
    this.nextMistake = 0;
  }

  getInput(now, driver) {
    const B = CONFIG.bots, P = this.preset, t = this.track, c = driver.car, n = t.n;
    if (driver.trackIndex < 0) return NEUTRAL_INPUT;
    const idx = driver.trackIndex;
    const speed = Math.max(c.speed, 0);

    // --- how sharp is the corner ahead, and which way? ---
    const ahead = Math.round((24 + speed * 1.4) / t.spacing);
    const a = t.tangents[idx], b = t.tangents[(idx + ahead) % n];
    const bend = Math.acos(clamp(a.x * b.x + a.z * b.z, -1, 1));
    const turn = Math.sign(a.z * b.x - a.x * b.z);               // +1 = left turn, -1 = right turn

    // --- aim point ahead on the track ---
    const look = Math.round((8 + speed * 0.5) / t.spacing);
    const ti = (idx + look) % n;
    const p = t.pts[ti], tan = t.tangents[ti];

    // sideways offset: racing line (cut the inside of the corner) + slow random wander
    let off = Math.sin(now * 0.0006 + this.seed) * t.width * B.wander * (1.2 - P.value);
    off += turn * t.width * 0.3 * clamp(bend / 0.7, 0, 1) * P.line;
    // good bots swing to a boost pad that is just ahead
    if (P.line >= 0.9) {
      for (const pad of t.pads) {
        const gap = (pad.i - idx + n) % n;
        if (gap > 4 && gap < Math.round(55 / t.spacing)) { off = pad.lane * t.width / 2; break; }
      }
    }
    off = clamp(off, -t.width * 0.4, t.width * 0.4);
    const tx = p.x + tan.z * off, tz = p.z - tan.x * off;        // left normal = (tan.z, -tan.x)
    const err = wrapAngle(Math.atan2(tx - c.x, tz - c.z) - c.heading);

    // easier bots make the odd steering mistake
    if (now > this.nextMistake) {
      this.mistake = (Math.random() - 0.5) * 2 * P.mistakes * 0.9;
      this.nextMistake = now + 1500 + Math.random() * 3000;
    }
    this.mistake *= 0.97;
    const noise = (Math.random() - 0.5) * 2 * B.steerNoise * (0.3 + P.mistakes * 3) + this.mistake;
    const steer = clamp(-err * B.steerGain + noise, -1, 1);      // steering right decreases heading

    // --- speed: top speed of the preset, slower in corners ---
    const top = CONFIG.car.maxSpeed * c.speedScale;
    const target = top * (1 - (1 - P.corner) * clamp(bend / 1.1, 0, 1));

    // drift through sharp corners (charges turbo), spend turbo on straights
    const D = CONFIG.drift;
    const drift = P.value > 0.5 && bend > B.driftBend && speed > D.minSpeed + 3 && Math.abs(steer) > 0.35;
    const turboAt = 0.9 - 0.6 * P.value;
    const turbo = P.value > 0.5 && c.turboMeter >= turboAt && bend < B.turboBend && speed > 12 && !c.airborne;

    return {
      steer,
      throttle: speed < target ? 1 : 0,
      brake: clamp((speed - target - 2) / 8, 0, 1),
      drift, turbo,
    };
  }
}
