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

  /** Simple circle collisions: push overlapping cars apart and scrub a little speed. */
  _collide() {
    const R = CONFIG.race.carRadius * 2, list = this.drivers;
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i].car, b = list[j].car;
      const dx = b.x - a.x, dz = b.z - a.z, d2 = dx * dx + dz * dz;
      if (d2 >= R * R || d2 === 0) continue;
      const d = Math.sqrt(d2), push = (R - d) / 2, nx = dx / d, nz = dz / d;
      // remote cars are driven by their owner: only push (and slow) the cars simulated here
      const ra = list[i].remote, rb = list[j].remote;
      if (ra && rb) continue;
      const fa = rb ? 2 : 1, fb = ra ? 2 : 1;
      if (!ra) { a.x -= nx * push * fa; a.z -= nz * push * fa; a.vx *= 0.985; a.vz *= 0.985; }
      if (!rb) { b.x += nx * push * fb; b.z += nz * push * fb; b.vx *= 0.985; b.vz *= 0.985; }
    }
  }
}
