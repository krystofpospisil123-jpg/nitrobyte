// A "driver" is anything that drives a car: a phone player, a keyboard player or (later) a bot.
// The game only ever works with a list of drivers, never with "the player".
// Each driver has a `controller` with getInput(now) -> { steer, throttle, brake, drift, turbo }.
import { CONFIG } from './config.js';
import { Car } from './car.js';

export const NEUTRAL_INPUT = { steer: 0, throttle: 0, brake: 0, drift: false, turbo: false };

/** Input coming from a phone over WebSocket. Keeps the latest message. */
export class PhoneController {
  constructor() { this.last = { ...NEUTRAL_INPUT }; this.lastTime = 0; }
  receive(msg) {
    this.last = {
      steer: Math.max(-1, Math.min(1, +msg.steer || 0)),
      throttle: Math.max(0, Math.min(1, +msg.throttle || 0)),
      brake: Math.max(0, Math.min(1, +msg.brake || 0)),
      drift: !!msg.drift, turbo: !!msg.turbo,
    };
    this.lastTime = performance.now();
  }
  getInput(now) {
    // Safety: if the phone went silent (lost Wi-Fi), release everything
    return now - this.lastTime > CONFIG.input.timeoutMs ? NEUTRAL_INPUT : this.last;
  }
}

/** Keyboard fallback, handy for testing without a phone. Arrows / WASD, Space = drift, Shift = turbo. */
export class KeyboardController {
  constructor() {
    this.keys = new Set();
    addEventListener('keydown', e => this.keys.add(e.code));
    addEventListener('keyup', e => this.keys.delete(e.code));
  }
  getInput() {
    const k = c => this.keys.has(c);
    return {
      steer: (k('ArrowLeft') || k('KeyA') ? -1 : 0) + (k('ArrowRight') || k('KeyD') ? 1 : 0),
      throttle: k('ArrowUp') || k('KeyW') ? 1 : 0,
      brake: k('ArrowDown') || k('KeyS') ? 1 : 0,
      drift: k('Space'), turbo: k('ShiftLeft') || k('ShiftRight'),
    };
  }
}

export class Driver {
  constructor({ id, name, color, kind, controller, style = 0, look = null, remote = false, netId = null }) {
    this.id = id;               // unique id ("phone0", "kb", "bot1", ...)
    this.name = name;
    this.color = color;         // css colour string
    this.kind = kind;           // 'human' | 'bot'
    this.controller = controller;
    this.look = look || Car.defaultLook(color, style);
    this.car = new Car(this.look);
    this.trackIndex = -1;       // last known nearest centre-line sample (search hint)
    this.offroad = false;
    // race state (reset by Race.start)
    this.lap = 0; this.nextCp = 0; this.progress = 0; this.place = 1;
    this.finished = false; this.finishTime = 0; this.autopilot = null; this.throttleSince = null;
    this.remote = remote;       // true = a car driven by another player / the host (online): we only show it
    this.netId = netId;         // id used in online messages
    this.net = null;            // latest state received from the network
    this.baseColor = color;     // original colour (the primary player's colour comes from the garage)
    this.runCoins = 0; this.reward = 0;   // coins collected / finish reward in the current race
  }

  /**
   * Online: move a remote car toward its last received state (with a little extrapolation) so it looks smooth
   * between the ~20 updates per second.  Remote cars do not run our physics.
   */
  applyNet(dt) {
    const n = this.net, c = this.car;
    if (!n) return;
    const age = Math.min(0.25, (performance.now() - n.t) / 1000);
    const tx = n.x + n.vx * age, tz = n.z + n.vz * age;
    if (Math.hypot(tx - c.x, tz - c.z) > 25) { c.x = tx; c.z = tz; c.heading = n.h; }       // far off (respawn / lag spike): snap
    else {
      const k = Math.min(1, dt * 14);
      c.x += (tx - c.x) * k; c.z += (tz - c.z) * k;
      c.heading += Math.atan2(Math.sin(n.h - c.heading), Math.cos(n.h - c.heading)) * k;
    }
    c.vx = n.vx; c.vz = n.vz; c.speed = n.sp; c.y = n.y; c.base = n.b; c.groundSlope = n.gs || 0;
    c.steer = n.st; c.drifting = !!n.dr; c.turboTime = n.tb; c.turboMeter = n.mt; c.airborne = !!n.air;
    c.landed = 0; c.hitWall = false; this.offroad = false;
    this.lap = n.lap; this.nextCp = n.cp; this.progress = n.pr;
    c.syncMesh();
  }

  /** Compact state for online messages (what remote players need to draw and rank this car). */
  packState() {
    const c = this.car, r = (v, k = 100) => Math.round(v * k) / k;
    return { id: this.netId, x: r(c.x), z: r(c.z), h: r(c.heading, 1000), sp: r(c.speed, 10), vx: r(c.vx, 10), vz: r(c.vz, 10),
      y: r(c.y), b: r(c.base), gs: r(c.groundSlope, 1000), st: r(c.steer, 100), dr: c.drifting ? 1 : 0, tb: r(c.turboTime), mt: r(c.turboMeter),
      air: c.airborne ? 1 : 0, lap: this.lap, cp: this.nextCp, pr: r(this.progress, 1000), fin: this.finished ? 1 : 0, ft: r(this.finishTime) };
  }

  /** Ground height under the car and road grade along its heading (drives hills + visuals). */
  _ground(track, p) {
    const c = this.car;
    c.base = track.groundFrom(c.x, c.z, p.index, p.dist);
    const near = p.dist < track.width / 2 + 4;                         // grade is only meaningful on / next to the road
    const t = p.tangent;
    c.groundSlope = near ? track.slope[p.index] * (t.x * Math.sin(c.heading) + t.z * Math.cos(c.heading)) : 0;
  }

  /** Put the car on grid slot `slot` of `track` (also snaps it to the ground). */
  placeOnGrid(track, slot) {
    const g = track.gridPosition(slot);
    this.car.place(g.x, g.z, g.heading, g.y);
    this.trackIndex = g.index; this.offroad = false;
  }

  /** Crash barrier: keep the car inside, cancel outward velocity and scrub some speed. */
  _wall(track) {
    const c = this.car, p = track.pts[this.trackIndex];
    const dx = c.x - p.x, dz = c.z - p.z, dist = Math.hypot(dx, dz), limit = track.barrierLimit;
    if (dist <= limit) return;
    const nx = dx / dist, nz = dz / dist;
    c.x = p.x + nx * limit; c.z = p.z + nz * limit;
    const vn = c.vx * nx + c.vz * nz;
    if (vn > 0) { c.vx -= nx * vn * 1.4; c.vz -= nz * vn * 1.4; }     // bounce a little
    c.vx *= 0.96; c.vz *= 0.96;
    c.hitWall = vn > 3;
  }

  /** Read input, run physics, update track-relative state. */
  update(dt, now, track, canDrive) {
    // Finished drivers are taken over by an autopilot; before GO everybody is held still
    const ctl = this.finished && this.autopilot ? this.autopilot : this.controller;
    const input = canDrive ? ctl.getInput(now, this) : NEUTRAL_INPUT;
    this.car.update(dt, input, { offroad: this.offroad, ramp: track.rampAt(this.car.x, this.car.z) });
    if (!this.car.airborne && track.padAt(this.car.x, this.car.z)) this.car.boost(CONFIG.pads.duration);   // boost pad
    const p = track.project(this.car.x, this.car.z, this.trackIndex);
    this.trackIndex = p.index;
    this.offroad = p.offroad;
    this.car.hitWall = false;
    if (track.barrierLimit) this._wall(track);
    this._ground(track, p);
  }
}
