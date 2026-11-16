// Builds a 3D track from a track data file and answers "where is this car relative to the road?".
import * as THREE from 'three';
import * as Scn from './scenery.js';
import { Car } from './car.js';

// Small seeded RNG (mulberry32) so decoration is deterministic
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Track {
  constructor(data, samples = 0) {
    this.data = data;
    this.width = data.width;
    this.laps = data.laps;

    // --- sample the spline into evenly spaced points ---
    const curve = new THREE.CatmullRomCurve3(
      data.points.map(([x, z]) => new THREE.Vector3(x, 0, z)), true, 'centripetal');
    this.length = curve.getLength();
    samples = samples || Math.round(this.length / 2.4);          // one sample every ~2.4 m
    this.pts = curve.getSpacedPoints(samples).slice(0, samples); // closed: drop duplicated last point
    this.n = this.pts.length;
    this.tangents = this.pts.map((p, i) => {
      const next = this.pts[(i + 1) % this.n];
      return new THREE.Vector3().subVectors(next, p).setY(0).normalize();
    });
    this.spacing = this.length / this.n;
    this._buildElevation();

    // bounding box / centre of the track (used for the distant backdrop)
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of this.pts) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); }
    this.center = new THREE.Vector3((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
    this.extent = Math.max(maxX - minX, maxZ - minZ) / 2;
    // optional crash barrier: cars cannot leave the road past this distance from the centre line
    this.barrier = data.theme.barrier || null;
    this.barrierLimit = this.barrier ? this.width / 2 + 1.8 : 0;
    this.animated = [];                 // update(t) callbacks for moving scenery
    this.gaps = [];                     // side streets branching off (street theme): { i, side, span }
    if (data.theme.street) this._planStreets();

    this.group = new THREE.Group();
    this._buildTerrain();
    this._buildRoad();
    this._buildStartLine();
    this._buildFeatures();
    this._buildBarrier();
    this._buildCoins();
    this._buildDecor();
    if (data.theme.street) this._buildStreets();
    this._buildExtras();
  }

  /**
   * Road height profile along the lap: a sum of sine waves (so it loops seamlessly),
   * lifted so the lowest point is at 0.  data.elevation = { waves: [[frequency, amplitude, phase], ...] }
   */
  _buildElevation() {
    const waves = (this.data.elevation && this.data.elevation.waves) || [];
    const raw = this.pts.map((_, i) => {
      const at = i / this.n;
      return waves.reduce((h, [f, a, ph]) => h + a * Math.sin(2 * Math.PI * (f * at + (ph || 0))), 0);
    });
    const min = Math.min(...raw, 0);
    this.elev = raw.map(h => h - min);                           // metres above sea level, never negative
    const n = this.n;
    this.slope = this.elev.map((_, i) => (this.elev[(i + 1) % n] - this.elev[(i - 1 + n) % n]) / (2 * this.spacing));   // rise per metre along the track
    this.terrain = { noise: 0, falloff: 60, ...(this.data.terrain || {}) };
  }

  /** Smooth rolling hills far away from the road (zero where the road is). */
  _noise(x, z) {
    const A = this.terrain.noise;
    if (!A) return 0;
    return A * (0.5 + 0.3 * Math.sin(x * 0.011 + 1.3) * Math.cos(z * 0.013 + 0.4) + 0.2 * Math.sin((x + z) * 0.027));
  }

  /**
   * Ground height at (x,z) given the nearest centre-line sample (`index`) and the distance to it.
   * Same function builds the terrain mesh and drives the cars, so they always agree.
   * Returns the height; the road slope along the track is this.slope[index].
   */
  groundFrom(x, z, index, dist) {
    const p = this.pts[index], tn = this.tangents[index];
    const along = (x - p.x) * tn.x + (z - p.z) * tn.z;
    const road = this.elev[index] + this.slope[index] * along;
    const inner = this.width / 2 + 4, k = Math.max(0, Math.min(1, (dist - inner) / this.terrain.falloff));
    const w = 1 - k * k * (3 - 2 * k);                           // 1 on / near the road, 0 far away
    return road * w + this._noise(x, z) * (1 - w);
  }

  /** Ground height at any point (searches the nearest sample; hint speeds it up). */
  groundAt(x, z, hint = -1) {
    const pr = this.project(x, z, hint);
    return this.groundFrom(x, z, pr.index, pr.dist);
  }

  /** Move animated scenery (hover cars, helicopters, blinking lights). t in seconds. */
  update(t) { for (const fn of this.animated) fn(t); }

  // ---------- queries ----------

  /**
   * Find the nearest centre-line sample to (x,z).
   * `hint` = previous index; searching only near it is fast and avoids jumping to another part of the track.
   * Returns { index, lateral (signed, + = left of travel direction), offroad, tangent }.
   */
  project(x, z, hint = -1) {
    let best = -1, bestD = Infinity;
    const test = i => {
      const p = this.pts[i];
      const d = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    };
    if (hint < 0) for (let i = 0; i < this.n; i++) test(i);
    else for (let k = -25; k <= 25; k++) test((hint + k + this.n) % this.n);

    const p = this.pts[best], t = this.tangents[best];
    // Left of travel direction (forward = (t.x, t.z), y up) is (t.z, -t.x)
    const side = (x - p.x) * t.z - (z - p.z) * t.x;
    const dist = Math.sqrt(bestD);
    const lateral = side > 0 ? dist : -dist;          // + = left of the centre line
    return { index: best, lateral, dist, offroad: dist > this.width / 2, tangent: t };
  }

  /** World position + heading of a grid slot. row/col are grid coordinates behind the start line. */
  gridPosition(slot) {
    const startIdx = this.data.start.index;
    const row = Math.floor(slot / 2), col = slot % 2 === 0 ? -1 : 1;
    const behind = 6 + row * 7;                         // metres behind the line
    const idx = (startIdx - Math.round(behind / this.spacing) + this.n) % this.n;
    const p = this.pts[idx], t = this.tangents[idx];
    const left = new THREE.Vector3(t.z, 0, -t.x);       // left of travel direction
    const pos = p.clone().addScaledVector(left, col * 3.2);
    // heading h such that forward = (sin h, cos h)
    return { x: pos.x, z: pos.z, y: this.elev[idx], heading: Math.atan2(t.x, t.z), index: idx };
  }

  /** Is the point on a ramp? Returns { h (surface height), slope } or null. */
  rampAt(x, z) {
    for (const r of this.ramps) {
      const dx = x - r.x0, dz = z - r.z0;
      const u = dx * r.tx + dz * r.tz;           // distance along the ramp
      const v = dx * r.tz - dz * r.tx;           // sideways offset
      if (u >= 0 && u <= r.L && Math.abs(v) <= r.W / 2) return { h: r.H * u / r.L, slope: r.H / r.L };
    }
    return null;
  }

  /**
   * Pick up coins near a car (called for human drivers). `y` = height of the car centre, `t` = time in seconds.
   * Collected coins vanish and respawn after CONFIG-free 25 s. Returns the coins collected: [{x, y, z, value}].
   */
  collectCoins(x, y, z, t) {
    const got = [];
    for (const c of this.coins) {
      if (c.back > t) continue;                                   // still waiting to respawn
      const dx = c.x - x, dz = c.z - z;
      if (dx * dx + dz * dz < 6.5 && Math.abs(c.y - y) < 3) { c.back = t + 25; got.push(c); }
    }
    return got;
  }

  /** Make every coin available again (start of a race). */
  resetCoins() { for (const c of this.coins) c.back = 0; }

  /** Is the point on a boost pad? */
  padAt(x, z) {
    for (const p of this.pads) {
      const dx = x - p.x, dz = z - p.z;
      if (Math.abs(dx * p.tx + dz * p.tz) <= p.len / 2 && Math.abs(dx * p.tz - dz * p.tx) <= p.wid / 2) return true;
    }
    return false;
  }

  // ---------- construction ----------

  /** World position on the centre line (fraction `at` of the lap) shifted sideways by `lane` (-1..1 of half width, + = left). */
  _placeAt(at, lane) {
    const i = Math.round(at * this.n) % this.n;
    const p = this.pts[i], t = this.tangents[i];
    const off = lane * this.width / 2;
    return { x: p.x + t.z * off, z: p.z - t.x * off, tx: t.x, tz: t.z, i, y: this.elev[i] };
  }

  /**
   * Coins: gold coins in lines along the road (value 1), a trail leading to every boost pad,
   * and a high arc of ruby coins (value 5) over every ramp - only reachable by jumping.
   */
  _buildCoins() {
    const rand = rng((this.data.seed || 1) * 97 + 3), n = this.n, coins = [];
    const at = (i, lane, extraY, value) => {
      i = ((i % n) + n) % n;
      const p = this.pts[i], tn = this.tangents[i], off = lane * this.width / 2;
      coins.push({ x: p.x + tn.z * off, z: p.z - tn.x * off, y: this.elev[i] + 1.3 + extraY, value, back: 0 });
    };
    const stepN = Math.max(1, Math.round(5 / this.spacing));       // a coin every ~5 m
    const startI = this.data.start.index, noGo = Math.round(45 / this.spacing);
    const groups = Math.round(this.length / 75);
    for (let g = 0; g < groups; g++) {
      const i0 = Math.floor(rand() * n);
      if (((startI - i0 + n) % n) < noGo || ((i0 - startI + n) % n) < noGo) continue;   // keep the grid and the garage showroom (just after the line) clear
      const lane = (rand() - 0.5) * 1.3, count = 5 + Math.floor(rand() * 4), weave = rand() < 0.4 ? 0.35 : 0;
      for (let k = 0; k < count; k++) at(i0 + k * stepN, lane + weave * Math.sin(k * 0.9), 0, 1);
    }
    for (const pd of this.data.pads || []) {                       // trail into each boost pad
      const i = Math.round(pd.at * n);
      for (let k = 4; k >= 2; k--) at(i - k * stepN, pd.lane || 0, 0, 1);
    }
    for (const rd of this.data.ramps || []) {                      // ruby arc above the jump
      const i = Math.round(rd.at * n), L = rd.length || 9;
      const base = Math.round((L / 2) / this.spacing);
      [[10, 3.6], [19, 4.6], [28, 4.0]].forEach(([d, h]) => at(i + base + Math.round(d / this.spacing), rd.lane || 0, h, 5));
    }
    this.coins = coins;

    // instanced meshes: gold discs and bigger ruby discs, standing on edge and spinning
    const geo = new THREE.CylinderGeometry(0.72, 0.72, 0.2, 10); geo.rotateZ(Math.PI / 2);
    const mk = (color, count) => { const m = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color }), Math.max(1, count)); m.frustumCulled = false; this.group.add(m); return m; };
    const gold = coins.filter(c => c.value === 1), ruby = coins.filter(c => c.value > 1);
    const goldMesh = mk(0xffc81a, gold.length), rubyMesh = mk(0xff3b8a, ruby.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), ps = new THREE.Vector3();
    const hide = new THREE.Matrix4().makeScale(0, 0, 0);
    const fill = (mesh, list, scale, time) => {
      list.forEach((c, i) => {
        if (c.back > time) { mesh.setMatrixAt(i, hide); return; }
        e.set(0, time * 3 + i, 0); q.setFromEuler(e);
        m4.compose(ps.set(c.x, c.y + Math.sin(time * 3 + i) * 0.18, c.z), q, sc.setScalar(scale));
        mesh.setMatrixAt(i, m4);
      });
      mesh.instanceMatrix.needsUpdate = true;
    };
    this.animated.push(time => { fill(goldMesh, gold, 1, time); fill(rubyMesh, ruby, 1.5, time); });
  }

  /** Boost pads and ramps from the track data (`pads: [{at, lane}]`, `ramps: [{at, lane, width, length, height}]`). */
  _buildFeatures() {
    this.pads = []; this.ramps = [];

    // chevron texture for the pads, pixel-art style
    const cv = document.createElement('canvas'); cv.width = 16; cv.height = 16;
    const g = cv.getContext('2d');
    g.fillStyle = '#0b2a6b'; g.fillRect(0, 0, 16, 16);
    g.fillStyle = '#ffe14a';
    for (const y0 of [2, 8]) for (let k = 0; k < 6; k++) { g.fillRect(8 - k, y0 + k * 0.5 | 0, 1, 1); g.fillRect(7 + k, y0 + k * 0.5 | 0, 1, 1); }
    const tex = new THREE.CanvasTexture(cv);
    tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter;

    for (const pd of this.data.pads || []) {
      const pos = this._placeAt(pd.at, pd.lane || 0);
      const len = 7, wid = 6;
      this.pads.push({ ...pos, len, wid, lane: pd.lane || 0 });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(wid, len), new THREE.MeshBasicMaterial({ map: tex }));
      m.rotation.x = -Math.PI / 2;
      const pivot = new THREE.Group();
      pivot.rotation.y = Math.atan2(-pos.tx, -pos.tz);   // arrow points along the travel direction
      pivot.position.set(pos.x, pos.y + 0.12, pos.z);
      pivot.add(m); this.group.add(pivot);
    }

    for (const rd of this.data.ramps || []) {
      const pos = this._placeAt(rd.at, rd.lane || 0);
      const W = rd.width || 9, L = rd.length || 9, H = rd.height || 1.8;
      const x0 = pos.x - pos.tx * L / 2, z0 = pos.z - pos.tz * L / 2;   // start (low end) of the ramp
      this.ramps.push({ x0, z0, tx: pos.tx, tz: pos.tz, L, W, H, y: pos.y });
      const rm = Track.rampMesh(L, W, H, x0, z0, pos.tx, pos.tz); rm.position.y += pos.y;
      this.group.add(rm);
    }
  }

  /** Wedge mesh: low end at the origin, rising along +x, width along z. */
  static rampMesh(L, W, H, x0, z0, tx, tz) {
    const hw = W / 2;
    const quad = (a, b, c, d) => [...a, ...b, ...c, ...a, ...c, ...d];
    const slope = quad([0, 0, -hw], [L, H, -hw], [L, H, hw], [0, 0, hw]);
    const sides = [0, 0, -hw, L, 0, -hw, L, H, -hw,  0, 0, hw, L, H, hw, L, 0, hw,
                   ...quad([L, 0, -hw], [L, 0, hw], [L, H, hw], [L, H, -hw])];
    const mk = (verts, color) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      geo.computeVertexNormals();
      return new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color, flatShading: true, side: THREE.DoubleSide }));
    };
    const grp = new THREE.Group();
    grp.add(mk(slope, 0xffa21a), mk(sides, 0x8a4a10));
    // white stripes across the slope, so it reads as a ramp from far away
    for (let k = 1; k <= 3; k++) {
      const u = L * k / 4, stripe = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, W - 0.6), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      stripe.position.set(u, H * u / L + 0.04, 0); stripe.rotation.z = Math.atan2(H, L);
      grp.add(stripe);
    }
    grp.position.set(x0, 0.02, z0);
    grp.rotation.y = Math.atan2(-tz, tx);               // local +x -> travel direction
    return grp;
  }


  /** Rolling terrain: a height-field grid that follows the road profile and fades into hills. */
  _buildTerrain() {
    const th = this.data.theme, M = this.terrain.falloff + 90, step = 5;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of this.pts) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); }
    minX -= M; maxX += M; minZ -= M; maxZ += M;
    const nx = Math.ceil((maxX - minX) / step), nz = Math.ceil((maxZ - minZ) / step);
    const pos = new Float32Array((nx + 1) * (nz + 1) * 3), col = new Float32Array((nx + 1) * (nz + 1) * 3);
    const base = new THREE.Color(th.ground), c = new THREE.Color();
    const trench = this.width / 2 + 1.6;
    let hint = -1;
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
      const x = minX + i * step, z = minZ + j * step, k = (j * (nx + 1) + i) * 3;
      const pr = this.project(x, z, -1);
      let h = this.groundFrom(x, z, pr.index, pr.dist);
      if (pr.dist < trench) h -= 0.7;                      // road bed: keeps the terrain under the road surface
      pos[k] = x; pos[k + 1] = h; pos[k + 2] = z;
      // colour: slightly lighter on high ground, with a checker-ish variation for a low-poly look
      const v = 0.86 + 0.14 * Math.sin(x * 0.09) * Math.cos(z * 0.083) + Math.min(0.25, h * 0.008);
      c.copy(base).multiplyScalar(v); col[k] = c.r; col[k + 1] = c.g; col[k + 2] = c.b;
    }
    const idx = [];
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i, b = a + 1, d = a + nx + 1, e = d + 1;
      idx.push(a, d, b, b, d, e);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(idx); g.computeVertexNormals();
    this.group.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })));
    // flat base far below, so nothing but ground colour shows beyond the terrain edge
    const far = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshBasicMaterial({ color: base.clone().multiplyScalar(0.8) }));
    far.rotation.x = -Math.PI / 2; far.position.y = -1; this.group.add(far);
  }

  /** Builds a ribbon strip between two offsets from the centre line, with per-segment vertex colours. */
  _ribbon(innerOff, outerOff, y, colorFn, skipFn = null, material = null) {
    const pos = [], col = [], uv = [], idx = [];
    const c = new THREE.Color();
    const uw = (outerOff - innerOff) / 10;                        // texture repeats every 10 m
    for (let i = 0; i <= this.n; i++) {
      const k = i % this.n;
      const p = this.pts[k], t = this.tangents[k];
      const nx = -t.z, nz = t.x; // perpendicular in XZ
      const e = this.elev[k] + y;
      pos.push(p.x + nx * innerOff, e, p.z + nz * innerOff);
      pos.push(p.x + nx * outerOff, e, p.z + nz * outerOff);
      uv.push(0, i * this.spacing / 10, uw, i * this.spacing / 10);
      c.set(colorFn(i)); col.push(c.r, c.g, c.b, c.r, c.g, c.b);
      if (i < this.n && !(skipFn && skipFn(i))) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, material || new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    return m;
  }

  _buildRoad() {
    const th = this.data.theme, w = this.width / 2, night = !!th.night;
    // wet night asphalt: glossy with puddles that mirror the neon (environment map is set by the game from the theme)
    const wet = th.wet || 0;
    const roadMat = wet ? new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 1, metalness: 0.55, roughnessMap: Scn.puddleTexture(), envMapIntensity: 0.9 * wet })
                        : null;
    this.group.add(this._ribbon(-w, w, 0.02, i => th.road[Math.floor(i / 4) % 2], null, roadMat));
    // kerbs on both sides, striped; at night they and the lane lines are unlit (they glow a little in the headlights)
    const dim = night ? 0.55 : 1, tint = c => new THREE.Color(c).multiplyScalar(dim).getHex();
    const unlit = () => night ? new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }) : null;
    const kerb = i => tint(th.kerb[Math.floor(i / 3) % 2]);
    this.group.add(this._ribbon(w, w + 1.2, 0.04, kerb, i => this._inGap(i, 1), unlit()));
    this.group.add(this._ribbon(-w - 1.2, -w, 0.04, kerb, i => this._inGap(i, -1), unlit()));
    // dashed lane lines (two lines -> three lanes)
    const lineCol = tint(th.lane ?? 0xdddddd);
    for (const off of [-w / 3, w / 3]) this.group.add(this._ribbon(off - 0.18, off + 0.18, 0.045, () => lineCol, i => i % 8 > 3, unlit()));
  }

  /** Crash barrier along both sides: vertical wall + coloured top strip. Colours alternate per segment. */
  _buildBarrier() {
    const B = this.barrier; if (!B) return;
    const off = this.width / 2 + 2.3, h = B.height ?? 1.3;
    for (const side of [-1, 1]) {
      const pos = [], col = [], idx = [], c = new THREE.Color();
      for (let i = 0; i <= this.n; i++) {
        const k = i % this.n, p = this.pts[k], tn = this.tangents[k];
        const x = p.x - tn.z * off * side, z = p.z + tn.x * off * side;
        pos.push(x, this.elev[k], z, x, this.elev[k] + h, z);
        c.set(B.colors[Math.floor(i / 5) % B.colors.length]); if (this.data.theme.night) c.multiplyScalar(0.6);    // softer neon at night (bloom adds the glow)
        col.push(c.r, c.g, c.b, c.r, c.g, c.b);
        if (i < this.n && !this._inGap(i, side)) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.setIndex(idx); g.computeVertexNormals();
      const mat = B.glow ? new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide })
                         : new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
      this.group.add(new THREE.Mesh(g, mat));
      // lighter cap on top
      const cap = this._ribbon(side > 0 ? off - 0.3 : -off - 0.3, side > 0 ? off + 0.3 : -off + 0.3, h + 0.02, () => B.cap ?? 0xffffff, i => this._inGap(i, side));
      this.group.add(cap);
    }
  }

  /** Sky, backdrop, overpasses/tunnels and animated sky agents from the theme / track data. */
  _buildExtras() {
    const th = this.data.theme, rand = rng((this.data.seed || 1) * 31 + 7);
    this.sky = Scn.makeSky(th); this.group.add(this.sky);
    if (th.backdrop) this.group.add(Scn.makeBackdrop(th.backdrop, this.center, this.extent + 190, th, rand));
    for (const o of this.data.overpasses || []) {
      const i = Math.round(o.at * this.n) % this.n, p = this.pts[i], tn = this.tangents[i];
      const g = Scn.overpass(o.kind, this.width, o.length || 30, th);
      g.position.set(p.x, this.elev[i], p.z); g.rotation.y = Math.atan2(tn.x, tn.z);
      this.group.add(g);
    }
    if (th.agents) this.animated.push(Scn.skyAgents(this, th.agents));
  }

  _buildStartLine() {
    const i = this.data.start.index;
    const p = this.pts[i], t = this.tangents[i];
    // checkerboard texture, nearest filtering for the retro look
    const cv = document.createElement('canvas'); cv.width = 16; cv.height = 2;
    const g = cv.getContext('2d');
    for (let x = 0; x < 16; x++) for (let y = 0; y < 2; y++) { g.fillStyle = (x + y) % 2 ? '#111' : '#fff'; g.fillRect(x, y, 1, 1); }
    const tex = new THREE.CanvasTexture(cv);
    tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter;
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(this.width, 2.4), new THREE.MeshBasicMaterial({ map: tex }));
    strip.rotation.x = -Math.PI / 2;                    // lie flat
    // Pivot rotated about Y so the strip's long side runs across the road
    const pivot = new THREE.Group();
    pivot.rotation.y = Math.atan2(-t.x, -t.z);
    pivot.position.set(p.x, this.elev[i] + 0.06, p.z);
    pivot.add(strip);
    this.group.add(pivot);
  }

  _buildDecor() {
    const th = this.data.theme, rand = rng(this.data.seed || 1);
    const flat = c => new THREE.MeshLambertMaterial({ color: c, flatShading: true });
    const pick = a => a[Math.floor(rand() * a.length)];
    const range = ([a, b]) => a + rand() * (b - a);

    for (const rule of this.data.decor || []) {
      let placed = 0, tries = 0;
      while (placed < rule.count && tries++ < rule.count * 30) {
        const i = Math.floor(rand() * this.n);
        const p = this.pts[i], t = this.tangents[i];
        const side = rand() < 0.5 ? -1 : 1;
        const off = this.width / 2 + rule.minDist + rand() * (rule.maxDist - rule.minDist);
        const x = p.x - t.z * off * side, z = p.z + t.x * off * side;

        // Reject spots that are too close to ANY part of the road (track may fold back near itself)
        if (this._distToRoad(x, z) < this.width / 2 + rule.minDist - 0.5) continue;

        const color = pick(rule.colors);
        const before = this.group.children.length, gy = this.groundAt(x, z);   // props stand on the terrain
        if (rule.kind === 'building') {
          const h = range(rule.height), w = range(rule.size), d = range(rule.size);
          if (th.windows) {                                   // lit-window skyscraper
            const base = new THREE.Color(color).multiplyScalar(0.3).getHex();
            const b = Scn.skyscraper(w, h, d, base, 1 + Math.floor(rand() * 4));
            b.position.set(x, 0, z); b.rotation.y = Math.round(rand() * 3) * Math.PI / 2 + Math.atan2(-t.x, t.z) * 0;
            this.group.add(b);
          } else {
            const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), flat(color));
            m.position.set(x, h / 2, z); m.rotation.y = rand() * Math.PI;
            this.group.add(m);
          }
        } else if (rule.kind === 'billboard') {
          this.group.add(Scn.billboard(x, z, p, rand));
        } else if (rule.kind === 'cliff') {
          const c = Scn.cliff(rule.colors, rand); c.position.set(x, 0, z); c.rotation.y = rand() * 6; this.group.add(c);
        } else if (rule.kind === 'derrick') {
          const c = Scn.derrick(); c.position.set(x, 0, z); c.rotation.y = rand() * 6; this.group.add(c);
        } else if (rule.kind === 'sign') {
          this.group.add(Scn.warningSign(p, x, z));
        } else if (rule.kind === 'tyres') {
          const c = Scn.tyreStack(); c.position.set(x, 0, z); this.group.add(c);
        } else if (rule.kind === 'lamp') {
          const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 6, 5), flat(0x555566));
          pole.position.set(x, 3, z);
          const bulb = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.5, 0.8), new THREE.MeshBasicMaterial({ color }));
          bulb.position.set(x, 6.2, z);
          this.group.add(pole, bulb);
          if (th.night) this.group.add(Scn.lampLight(x, z, p.x, p.z, color));      // halo + pool of light on the road
        } else if (rule.kind === 'cactus') {
          const h = 3 + rand() * 3;
          const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, h, 6), flat(color));
          stem.position.set(x, h / 2, z);
          const arm = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.5, 0.5), flat(color));
          arm.position.set(x + 0.9, h * 0.6, z);
          const armUp = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.4, 0.5), flat(color));
          armUp.position.set(x + 1.5, h * 0.6 + 0.7, z);
          this.group.add(stem, arm, armUp);
        } else if (rule.kind === 'rock') {
          const s = 0.8 + rand() * 2.2;
          const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), flat(color));
          rock.position.set(x, s * 0.5, z); rock.rotation.set(rand() * 3, rand() * 3, rand() * 3);
          this.group.add(rock);
        } else if (rule.kind === 'tree') {
          const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, 3, 5), flat(0x6b4a2b));
          trunk.position.set(x, 1.5, z);
          const crown = new THREE.Mesh(new THREE.ConeGeometry(2.6, 7, 6), flat(color));
          crown.position.set(x, 6, z);
          this.group.add(trunk, crown);
        }
        for (let q = before; q < this.group.children.length; q++) this.group.children[q].position.y += gy;
        placed++;
      }
    }
  }

  // ---------- street city (theme.street) ----------

  /** Is sample i inside a side-street opening on `side` (+1 / -1)? */
  _inGap(i, side, pad = 0) {
    for (const g of this.gaps) {
      if (g.side !== side) continue;
      let d = Math.abs(i - g.i); d = Math.min(d, this.n - d);
      if (d <= g.span + pad) return true;
    }
    return false;
  }

  /** Straight enough here for a junction? */
  _straight(i, reach = 10) {
    const a = this.tangents[(i - reach + this.n) % this.n], b = this.tangents[(i + reach) % this.n];
    return a.x * b.x + a.z * b.z > 0.995;
  }

  /** Point at `off` metres from the centre line at sample i, on `side` (+1 = left of travel). */
  _side(i, off, side) {
    const p = this.pts[i], t = this.tangents[i];
    return { x: p.x - t.z * off * side, z: p.z + t.x * off * side };
  }

  /** Choose where side streets branch off (deterministic). */
  _planStreets() {
    const rand = rng((this.data.seed || 1) * 131 + 5), w = this.width / 2, sp = this.spacing;
    const half = 7, span = Math.round(half / sp);
    let next = Math.round((40 + rand() * 40) / sp);
    for (let i = next; i < this.n - 30 / sp; i++) {
      if (i < next || !this._straight(i, Math.round(22 / sp))) continue;
      const side = rand() < 0.5 ? -1 : 1;
      let ok = true;                                            // the street must not run into another part of the track
      for (let o = 14; o <= 70 && ok; o += 7) for (const dz of [-half, 0, half]) {
        const q = this._side((i + Math.round(dz / sp) + this.n) % this.n, w + o, side);
        if (this._distToRoad(q.x, q.z) < w + 6) ok = false;
      }
      if (!ok) { next = i + Math.round(10 / sp); continue; }
      this.gaps.push({ i, side, span });
      next = i + Math.round((70 + rand() * 50) / sp);
    }
  }

  _buildStreets() {
    const th = this.data.theme, rand = rng((this.data.seed || 1) * 97 + 3), w = this.width / 2, sp = this.spacing, n = this.n;
    const G = this.group, flat = c => new THREE.MeshLambertMaterial({ color: c, flatShading: true });
    const SW = w + 6.5;                                         // sidewalk outer edge = building line
    // sidewalks (raised concrete slabs), cut at the side streets
    const swCol = i => (Math.floor(i / 2) % 2 ? 0x45464e : 0x3e3f47);
    G.add(this._ribbon(w + 1.2, SW, 0.18, swCol, i => this._inGap(i, 1)));
    G.add(this._ribbon(-SW, -w - 1.2, 0.18, swCol, i => this._inGap(i, -1)));
    const heading = i => Math.atan2(this.tangents[i].x, this.tangents[i].z);

    // --- side streets: road stub, centre line, crossing, road block, parked cars, buildings along it ---
    const lights = [];
    for (const gp of this.gaps) {
      const { i, side } = gp, e = this.elev[i], t = this.tangents[i], hd = heading(i);
      const stubLen = 70, mid = this._side(i, w + stubLen / 2, side);
      const stub = new THREE.Mesh(new THREE.PlaneGeometry(12, stubLen), flat(th.road[0]));
      stub.rotation.order = 'YXZ'; stub.rotation.y = hd + Math.PI / 2; stub.rotation.x = -Math.PI / 2;
      stub.position.set(mid.x, e + 0.01, mid.z); G.add(stub);
      for (let o = 8; o < stubLen; o += 6) {                    // dashed centre line
        const q = this._side(i, w + o, side), d = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.03, 0.25), flat(0xc8bf98));
        d.position.set(q.x, e + 0.03, q.z); d.rotation.y = hd; G.add(d);
      }
      for (let k = -2; k <= 2; k++) {                           // zebra crossing on the main road just before the junction
        const ci = (i - Math.round(11 / sp) + n) % n, q = this._side(ci, k * 2.6, 1);
        const z = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.03, 3.2), flat(0xcfcfd4));
        z.position.set(q.x, this.elev[ci] + 0.05, q.z); z.rotation.y = heading(ci); G.add(z);
      }
      const bq = this._side(i, w + 2.3, side), bar = Scn.barricade(12.5);       // the invisible barrier line gets a road block
      bar.position.set(bq.x, e, bq.z); bar.rotation.y = hd + Math.PI / 2; G.add(bar);
      const lq = this._side((i + Math.round(10 / sp)) % n, w + 4, side), tl = Scn.trafficLight(rand() * 12);
      tl.position.set(lq.x, e + 0.18, lq.z); tl.rotation.y = hd + (side > 0 ? Math.PI / 2 : -Math.PI / 2); G.add(tl); lights.push(tl);
      for (let k = 0; k < 3; k++) {                             // parked cars along the side street
        if (rand() < 0.3) continue;
        const o = w + 16 + k * 14, lane = (k % 2 ? 1 : -1) * 4.2, q = this._side(i, o, side);
        const look = { color: [0xb0b4bc, 0x2a2e3a, 0x8a1a22, 0x1a3a6a, 0xd0d0d4, 0x3a5a3a][Math.floor(rand() * 6)], body: ['coupe', 'hatch', 'jdm', 'pickup'][Math.floor(rand() * 4)], skin: 'none', wing: 1, rims: 0x9aa0aa, glow: null, flame: 0xffa21a };
        const car = Car.buildMesh(look); car.userData.under.visible = false; car.userData.beams.visible = false;
        car.position.set(q.x + t.x * lane, e, q.z + t.z * lane); car.rotation.y = hd + Math.PI / 2 * (rand() < 0.5 ? 1 : -1); G.add(car);
      }
      for (const along of [-1, 1]) for (let k = 0; k < 3; k++) {     // buildings lining the side street
        const o = w + 16 + k * 18, q = this._side(i, o, side), d = 14 + rand() * 6, h = 10 + rand() * 26;
        const x = q.x + t.x * along * (6 + 1.5 + d / 2), z = q.z + t.z * along * (6 + 1.5 + d / 2);
        if (this._distToRoad(x, z) < SW + d / 2 - 1) continue;
        const b = Scn.streetBuilding(d, h, 16, this._buildingBase(rand), 1 + Math.floor(rand() * 4), along, rand);
        b.position.set(x, this.elev[i], z); b.rotation.y = hd + Math.PI / 2; G.add(b);
      }
    }
    this.animated.push(time => Scn.updateLights(lights, time));

    // --- building rows along the main road ---
    for (const side of [-1, 1]) {
      let s = 0;
      while (s < n) {
        const fl = 9 + rand() * 10, steps = Math.max(2, Math.round(fl / sp)), ic = (s + Math.round(steps / 2)) % n;
        if (this._inGap(ic, side, Math.round((fl / 2 + 3) / sp))) { s += Math.max(1, Math.round(4 / sp)); continue; }
        const tall = rand() < 0.12, d = 12 + rand() * 12, h = tall ? 45 + rand() * 30 : 9 + rand() * 24;
        const q = this._side(ic, SW + 0.3 + d / 2, side), hd = heading(ic), t = this.tangents[ic];
        // all four corners must keep clear of every part of the road (corners of the lap, other streets)
        let ok = true;
        const nx = -t.z * side, nz = t.x * side;                 // away from the road
        for (const [a, b] of [[-1, -1], [-1, 1], [1, -1], [1, 1], [0, 0]]) {
          const lx = a * d / 2, lz = b * fl / 2;
          const x = q.x + nx * lx + t.x * lz, z = q.z + nz * lx + t.z * lz;
          if (this._distToRoad(x, z) < SW - 0.5) { ok = false; break; }
        }
        if (ok) {
          const b = Scn.streetBuilding(d, h, fl - 0.4, this._buildingBase(rand), 1 + Math.floor(rand() * 4), side, rand);
          b.position.set(q.x, this.elev[ic], q.z); b.rotation.y = hd; G.add(b);
        }
        s += steps;
      }
    }

    // --- street lamps and trees on the sidewalks ---
    const step = Math.round(26 / sp), cols = th.lampColors || [0xffb347];
    for (let i = 0; i < n; i += step) {
      const side = (i / step) % 2 ? 1 : -1;
      if (this._inGap(i, side, Math.round(4 / sp))) continue;
      const q = this._side(i, w + 2.6, side), col = cols[Math.floor(rand() * cols.length)];
      const lamp = Scn.streetLamp(col); lamp.position.set(q.x, this.elev[i] + 0.18, q.z);
      lamp.rotation.y = heading(i) + (side > 0 ? 0 : Math.PI); G.add(lamp);
      const light = Scn.lampLight(q.x, q.z, this.pts[i].x, this.pts[i].z, col); light.position.y = this.elev[i]; G.add(light);
      const j = (i + Math.round(step / 2)) % n;
      if (rand() < 0.55 && !this._inGap(j, -side, Math.round(4 / sp))) {
        const tq = this._side(j, w + 4.2, -side), tree = Scn.streetTree(rand); tree.position.set(tq.x, this.elev[j] + 0.18, tq.z); G.add(tree);
      }
    }
  }

  _buildingBase(rand) {
    const cols = this.data.theme.buildingColors || [0x6a5a50, 0x50586a, 0x6a6058, 0x585060, 0x7a6a5a, 0x4a5058];
    return new THREE.Color(cols[Math.floor(rand() * cols.length)]).multiplyScalar(0.45).getHex();
  }

  _distToRoad(x, z) {
    let best = Infinity;
    for (let i = 0; i < this.n; i += 2) {
      const p = this.pts[i];
      const d = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  }
}
