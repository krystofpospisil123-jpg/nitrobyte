// Race rules: countdown, checkpoints, laps, positions, finishing, car-to-car collisions.
import { CONFIG } from './config.js';
import { BotController } from './bot.js';

export class Race {
  constructor(track, drivers) {
    this.track = track;
    this.drivers = drivers;       // shared live list owned by main.js
    this.state = 'lobby';         // lobby | countdown | racing | results
    this.countdown = 0;
    this.time = 0;                // race clock (s)
    this.finishOrder = [];
    this.onEvent = () => {};      // set by main.js: (type, driver) for HUD messages
    this.onBump = () => {};       // (remote driver, dvx, dvz, strength): a hit main.js sends to that car's owner
  }

  get totalLaps() { return this.laps ?? this.track.laps; }   // `laps` is set from the menu

  /** Put every driver on the grid and begin the countdown. */
  start() {
    this.drivers.forEach((d, i) => {
      d.placeOnGrid(this.track, i);
      d.car.speedScale = 1;
      Object.assign(d, { lap: 0, nextCp: 0, progress: 0, finished: false, finishTime: 0, place: i + 1, autopilot: null, throttleSince: null, runCoins: 0, reward: 0, net: null });
    });
    this.finishOrder = [];
    this.time = 0;
    this.countdown = CONFIG.race.countdown;
    this.state = 'countdown';
  }

  update(dt, now = performance.now()) {
    if (this.state === 'countdown') {
      this.countdown -= dt;
      // Rocket start: remember when each human pressed the gas (must stay held until GO)
      for (const d of this.drivers) {
        if (d.kind !== 'human' || d.remote) continue;
        const pressed = d.controller.getInput(now, d).throttle > 0.5;
        if (pressed && d.throttleSince === null) d.throttleSince = this.countdown;
        if (!pressed) d.throttleSince = null;
      }
      if (this.countdown <= 0) { this.state = 'racing'; this.time = 0; this._launch(); }
    } else if (this.state === 'racing' || this.state === 'results') {
      this.time += dt;
      for (const d of this.drivers) this._progress(d);
      this._standings();
      this._rubberBand();
      const humans = this.drivers.filter(d => d.kind === 'human');
      if (this.state === 'racing' && humans.length && humans.every(d => d.finished)) this.state = 'results';
    }
    if (this.state !== 'lobby') this._collide();
  }

  /** At GO: humans who pressed the gas in the right moment get a rocket start; bots roll the dice. */
  _launch() {
    const R = CONFIG.rocketStart;
    for (const d of this.drivers) {
      if (d.remote) continue;                           // remote cars boost on their own machine
      let ok;
      if (d.kind === 'human') ok = d.throttleSince !== null && d.throttleSince <= R.window;
      else ok = Math.random() < CONFIG.rocketStartChance * (d.controller.difficulty ?? 1);
      if (ok) { d.car.boost(R.duration); this.onEvent('rocket', d); }
    }
  }

  /**
   * Bot speed = preset top speed (x per-bot skill), plus rubber banding:
   * bots behind the leading human speed up, bots far ahead ease off (never below the preset's floor).
   */
  _rubberBand() {
    const B = CONFIG.bots, P = B.preset || CONFIG.difficulties[2];
    const humans = this.drivers.filter(d => d.kind === 'human');
    const ref = humans.length ? Math.max(...humans.map(d => d.progress)) : null;
    for (const d of this.drivers) {
      if (d.kind !== 'bot' || d.remote) continue;
      const base = P.speed * (d.controller.skill ?? 1);
      if (d.finished || ref === null) { d.car.speedScale = base; continue; }
      const behind = ref - d.progress;                            // in checkpoints (1 = 1/8 lap)
      d.car.speedScale = base * (1 + Math.max(P.rubberMin, Math.min(P.rubberMax, behind * B.rubberPerCheckpoint)));
    }
  }

  /** Cars may only move while racing. */
  get canDrive() { return this.state === 'racing' || this.state === 'results'; }

  _progress(d) {
    if (d.remote) return;                               // remote cars report their own progress
    const t = this.track, n = t.n, cp = CONFIG.race.checkpoints, per = n / cp;
    if (d.finished) return;
    const target = (t.data.start.index + (d.nextCp + 1) * per) % n;   // last checkpoint = finish line
    const diff = ((d.trackIndex - target + n * 1.5) % n) - n / 2;     // signed circular difference
    if (diff >= 0 && diff < per * 0.6) {
      d.nextCp++;
      if (d.nextCp >= cp) {
        d.nextCp = 0; d.lap++;
        if (d.lap >= this.totalLaps) {
          d.finished = true; d.finishTime = this.time;
          this.finishOrder.push(d);
          this.onEvent('finish', d, this.finishOrder.length);
          d.autopilot = new BotController(t, CONFIG.difficulties[1]);   // finished cars keep driving on their own
          return;
        }
      }
    }
    const dist = (target - d.trackIndex + n) % n;                     // samples still to the next checkpoint
    d.progress = d.lap * cp + d.nextCp + Math.max(0, 1 - dist / per);
  }

  _standings() {
    const order = [...this.drivers].sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.progress - a.progress;
    });
    order.forEach((d, i) => { d.place = i + 1; });
    this.order = order;
  }

  /**
   * Car-to-car hits: separate the cars, then exchange momentum along the contact normal.
   * The car that drives INTO the other (and a car on turbo) counts as heavier, so it knocks the other one away.
   * Remote cars are driven by their owner: we only change the cars simulated here and report the rest via onBump.
   */
  _collide() {
    const R = CONFIG.race.carRadius * 2, list = this.drivers, K = CONFIG.race.bumpForce;
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const A = list[i], B = list[j], a = A.car, b = B.car;
      const dx = b.x - a.x, dz = b.z - a.z, d2 = dx * dx + dz * dz;
      if (d2 >= R * R || d2 === 0 || Math.abs((a.base + a.y) - (b.base + b.y)) > 2.5) continue;
      const d = Math.sqrt(d2), push = (R - d) / 2, nx = dx / d, nz = dz / d;
      const ra = A.remote, rb = B.remote;
      if (ra && rb) continue;
      const fa = rb ? 2 : 1, fb = ra ? 2 : 1;
      if (!ra) { a.x -= nx * push * fa; a.z -= nz * push * fa; }
      if (!rb) { b.x += nx * push * fb; b.z += nz * push * fb; }
      // closing speed along the normal (negative = moving into each other)
      const vn = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
      if (vn >= -0.5) continue;
      const sa = Math.max(0, a.vx * nx + a.vz * nz), sb = Math.max(0, -(b.vx * nx + b.vz * nz));   // who drives into whom
      const ma = (1 + sa / 15) * (a.turboTime > 0 ? 1.6 : 1), mb = (1 + sb / 15) * (b.turboTime > 0 ? 1.6 : 1);
      const J = -vn * K / (1 / ma + 1 / mb);
      const MAXDV = CONFIG.race.bumpMax;
      const dva = Math.min(MAXDV, J / ma), dvb = Math.min(MAXDV, J / mb);   // speed change of each car along the normal
      // the hit car is also shoved sideways, away from the hitter's path (so it gets knocked off the line, not just forward)
      const side = (vx, vz, rx, rz, dv) => { const l = Math.hypot(vx, vz) || 1, px = -vz / l, pz = vx / l, s = Math.sign(rx * px + rz * pz) || 1; return [px * s * dv * 0.6, pz * s * dv * 0.6]; };
      const [la, lza] = dva > dvb ? side(b.vx, b.vz, -nx, -nz, dva) : [0, 0];
      const [lb, lzb] = dvb >= dva ? side(a.vx, a.vz, nx, nz, dvb) : [0, 0];
      const A1 = [-nx * dva * 0.6 + la, -nz * dva * 0.6 + lza], B1 = [nx * dvb * 0.6 + lb, nz * dvb * 0.6 + lzb];
      if (!ra) a.bump(A1[0], A1[1], dva); else this.onBump(A, A1[0], A1[1], dva);
      if (!rb) b.bump(B1[0], B1[1], dvb); else this.onBump(B, B1[0], B1[1], dvb);
      this.onEvent('crash', dvb > dva ? B : A, Math.max(dva, dvb), (a.x + b.x) / 2, (a.z + b.z) / 2, A, B);
    }
  }
}
