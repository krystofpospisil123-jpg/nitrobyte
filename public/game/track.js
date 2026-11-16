// Builds a 3D track from a track data file and answers "where is this car relative to the road?".
import * as THREE from 'three';
import * as Scn from './scenery.js';

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

    this.group = new THREE.Group();
    this._buildTerrain();
    this._buildRoad();
    this._buildStartLine();
    this._buildFeatures();
    this._buildBarrier();
    this._buildCoins();
    this._buildDecor();
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
  _ribbon(innerOff, outerOff, y, colorFn, skipFn = null) {
    const pos = [], col = [], idx = [];
    const c = new THREE.Color();
    for (let i = 0; i <= this.n; i++) {
      const k = i % this.n;
      const p = this.pts[k], t = this.tangents[k];
      const nx = -t.z, nz = t.x; // perpendicular in XZ
      const e = this.elev[k] + y;
      pos.push(p.x + nx * innerOff, e, p.z + nz * innerOff);
      pos.push(p.x + nx * outerOff, e, p.z + nz * outerOff);
      c.set(colorFn(i)); col.push(c.r, c.g, c.b, c.r, c.g, c.b);
      if (i < this.n && !(skipFn && skipFn(i))) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    return m;
  }

  _buildRoad() {
    const th = this.data.theme, w = this.width / 2;
    this.group.add(this._ribbon(-w, w, 0.02, i => th.road[Math.floor(i / 4) % 2]));
    // kerbs on both sides, striped
    const kerb = i => th.kerb[Math.floor(i / 3) % 2];
    this.group.add(this._ribbon(w, w + 1.2, 0.04, kerb));
    this.group.add(this._ribbon(-w - 1.2, -w, 0.04, kerb));
    // dashed lane lines (two lines -> three lanes)
    const lineCol = th.lane ?? 0xdddddd;
    for (const off of [-w / 3, w / 3]) this.group.add(this._ribbon(off - 0.18, off + 0.18, 0.045, () => lineCol, i => i % 8 > 3));
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
        c.set(B.colors[Math.floor(i / 5) % B.colors.length]); col.push(c.r, c.g, c.b, c.r, c.g, c.b);
        if (i < this.n) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.setIndex(idx); g.computeVertexNormals();
      const mat = B.glow ? new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide })
                         : new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
      this.group.add(new THREE.Mesh(g, mat));
      // lighter cap on top
      const cap = this._ribbon(side > 0 ? off - 0.3 : -off - 0.3, side > 0 ? off + 0.3 : -off + 0.3, h + 0.02, () => B.cap ?? 0xffffff);
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
