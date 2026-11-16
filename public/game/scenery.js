// Scenery builders: sky, distant backdrop, themed props (billboards, skyscrapers, canyon walls...),
// tunnels / gantries and animated sky agents (hover police cars, helicopters).
// Everything is low-poly boxes/cones with nearest-filtered canvas textures for the retro look.
import * as THREE from 'three';

const nearest = t => { t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; return t; };
const hex = c => '#' + c.toString(16).padStart(6, '0');
const flat = c => new THREE.MeshLambertMaterial({ color: c, flatShading: true });
const glow = c => new THREE.MeshBasicMaterial({ color: c });

// ---------- textures ----------
const winCache = new Map();
/** Building facade: dark wall with lit windows. Returns { map, emissive } (both pixel textures). */
export function windowTextures(base, seed = 1) {
  const key = base + ':' + seed;
  if (winCache.has(key)) return winCache.get(key);
  const W = 8, H = 16, S = 4;                       // 8x16 windows, 4 px each
  const a = document.createElement('canvas'), b = document.createElement('canvas');
  a.width = b.width = W * S; a.height = b.height = H * S;
  const ga = a.getContext('2d'), gb = b.getContext('2d');
  ga.fillStyle = hex(base); ga.fillRect(0, 0, a.width, a.height);
  gb.fillStyle = '#000'; gb.fillRect(0, 0, b.width, b.height);
  const lights = ['#ffe9a8', '#7fe8ff', '#ff9ad5', '#ffd27a'];
  let s = seed * 9301;
  const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (x % 2 === 1 || y % 2 === 1) continue;       // windows on a 2-cell grid, gaps between
    const lit = r() < 0.55, col = lights[Math.floor(r() * lights.length)];
    ga.fillStyle = lit ? col : '#0d1030'; ga.fillRect(x * S, y * S, S * 1.5 | 0, S * 1.5 | 0);
    if (lit) { gb.fillStyle = col; gb.fillRect(x * S, y * S, S * 1.5 | 0, S * 1.5 | 0); }
  }
  const res = { map: nearest(new THREE.CanvasTexture(a)), emissive: nearest(new THREE.CanvasTexture(b)) };
  for (const t of [res.map, res.emissive]) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  winCache.set(key, res);
  return res;
}

let _soft = null;
/** Soft round glow (white, fades to nothing): used for lamp halos and light pools. */
export function softGlow() {
  if (_soft) return _soft;
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const g = cv.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return (_soft = new THREE.CanvasTexture(cv));
}

/** Street lamp light: a halo around the bulb and a pool of light on the road, pulled toward the road point (tx, tz). */
export function lampLight(x, z, tx, tz, color) {
  const g = new THREE.Group(); g.position.set(x, 0, z);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: softGlow(), color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false }));
  halo.material.color.multiplyScalar(0.55);
  halo.scale.setScalar(4); halo.position.y = 6.2; g.add(halo);
  const d = Math.hypot(tx - x, tz - z) || 1;
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(17, 17), new THREE.MeshBasicMaterial({ color, map: softGlow(), transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
  pool.rotation.x = -Math.PI / 2; pool.position.set((tx - x) / d * 6, 0.16, (tz - z) / d * 6); g.add(pool);
  return g;
}

let _puddle = null;
/** Roughness map of a wet road: mostly dry-ish asphalt with shiny puddles (tileable). Green channel = roughness. */
export function puddleTexture() {
  if (_puddle) return _puddle;
  const S = 128, cv = document.createElement('canvas'); cv.width = cv.height = S;
  const g = cv.getContext('2d');
  g.fillStyle = 'rgb(120,120,120)'; g.fillRect(0, 0, S, S);
  let s = 12345; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 26; i++) {
    const x = r() * S, y = r() * S, rad = 6 + r() * 16, dark = 25 + r() * 35;
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {                // draw wrapped copies so it tiles
      const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rad);
      gr.addColorStop(0, `rgba(${dark},${dark},${dark},1)`); gr.addColorStop(1, 'rgba(120,120,120,0)');
      g.fillStyle = gr; g.fillRect(x + ox - rad, y + oy - rad, rad * 2, rad * 2);
    }
  }
  const t = new THREE.CanvasTexture(g.canvas); t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return (_puddle = t);
}

const boardCache = new Map();
/** Neon billboard texture with text. */
export function billboardTexture(text, c1, c2) {
  const key = text + c1 + c2;
  if (boardCache.has(key)) return boardCache.get(key);
  const cv = document.createElement('canvas'); cv.width = 128; cv.height = 48;
  const g = cv.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 128, 48); grad.addColorStop(0, hex(c1)); grad.addColorStop(1, hex(c2));
  g.fillStyle = grad; g.fillRect(0, 0, 128, 48);
  g.fillStyle = 'rgba(0,0,0,.25)'; for (let y = 0; y < 48; y += 4) g.fillRect(0, y, 128, 1);   // scanlines
  g.font = 'bold 26px "Courier New", monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 4; g.strokeStyle = '#1a0a3a'; g.strokeText(text, 64, 26);
  g.fillStyle = '#fff'; g.fillText(text, 64, 26);
  g.strokeStyle = '#fff'; g.lineWidth = 2; g.strokeRect(2, 2, 124, 44);
  const t = nearest(new THREE.CanvasTexture(cv));
  boardCache.set(key, t);
  return t;
}

// ---------- sky ----------
/** Gradient dome + sun disc + stars. Re-centre it on the camera every frame. */
export function makeSky(th) {
  const grp = new THREE.Group();
  const R = 1000, geo = new THREE.SphereGeometry(R, 20, 14);
  const top = new THREE.Color(th.skyTop ?? th.sky), mid = new THREE.Color(th.skyMid ?? th.sky), bot = new THREE.Color(th.skyBottom ?? th.fog);
  const col = [], p = geo.attributes.position, c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const t = Math.max(0, p.getY(i) / R);                      // 0 at the horizon, 1 straight up
    if (t < 0.35) c.copy(bot).lerp(mid, t / 0.35); else c.copy(mid).lerp(top, (t - 0.35) / 0.65);
    col.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const dome = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  dome.renderOrder = -10; grp.add(dome);

  if (th.sunDisc) {                                             // big low sun
    const sun = new THREE.Mesh(new THREE.CircleGeometry(R * 0.11, 16), new THREE.MeshBasicMaterial({ color: th.sunDisc, fog: false, depthWrite: false }));
    sun.position.set(-R * 0.55, R * 0.18, -R * 0.8); sun.lookAt(0, 0, 0); sun.renderOrder = -9; grp.add(sun);
  }
  if (th.stars) {
    const n = 260, pos = [];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, e = 0.12 + Math.random() * 1.3;
      pos.push(Math.cos(a) * Math.cos(e) * R * 0.95, Math.sin(e) * R * 0.95, Math.sin(a) * Math.cos(e) * R * 0.95);
    }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false, fog: false, depthWrite: false }));
    stars.renderOrder = -9; grp.add(stars);
  }
  return grp;
}

/** Ring of distant silhouettes around the track: skyline, mesas or hills. */
export function makeBackdrop(kind, center, radius, th, rand) {
  const grp = new THREE.Group();
  const n = kind === 'skyline' ? 70 : 34;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rand() * 0.05, d = radius + rand() * 70;
    const x = center.x + Math.cos(a) * d, z = center.z + Math.sin(a) * d;
    let m;
    if (kind === 'skyline') {
      const h = 40 + rand() * 120, w = 18 + rand() * 26;
      const tx = windowTextures(th.skylineColor ?? 0x241a55, 3 + (i % 4));
      const geo = new THREE.BoxGeometry(w, h, w);
      scaleUV(geo, w, w, h, 7);
      m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tx.map, fog: false, color: 0x9a8ad0 }));
      m.position.set(x, h / 2, z);
    } else if (kind === 'mesas') {
      const h = 30 + rand() * 60, w = 50 + rand() * 80;
      m = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.55, w * 0.8, h, 6 + (i % 3)), new THREE.MeshBasicMaterial({ color: th.mesaColor ?? 0x7a3a3a, fog: false }));
      m.position.set(x, h / 2, z);
    } else {
      const h = 40 + rand() * 50, w = 70 + rand() * 60;
      m = new THREE.Mesh(new THREE.ConeGeometry(w, h, 6), new THREE.MeshBasicMaterial({ color: th.hillColor ?? 0x2d6a4a, fog: false }));
      m.position.set(x, h / 2, z);
    }
    grp.add(m);
  }
  return grp;
}

/** Scale box UVs so textures tile in whole windows: sides use (width, height), tops are ignored. */
function scaleUV(geo, w, d, h, cell) {
  const uv = geo.attributes.uv;
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z; 4 vertices each
  const faceW = [d, d, w, w, w, w];
  for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) {
    const i = f * 4 + k;
    const horiz = f === 2 || f === 3 ? d : faceW[f], vert = f === 2 || f === 3 ? w : h;
    uv.setXY(i, uv.getX(i) * Math.max(1, Math.round(horiz / cell)) / 2, uv.getY(i) * Math.max(1, Math.round(vert / cell)) / 4);
  }
}

// ---------- props ----------
/** A skyscraper with a lit window texture. */
export function skyscraper(w, h, d, base, seed) {
  const tx = windowTextures(base, seed);
  const geo = new THREE.BoxGeometry(w, h, d);
  scaleUV(geo, w, d, h, 4);
  const mat = new THREE.MeshLambertMaterial({ map: tx.map, emissiveMap: tx.emissive, emissive: 0xffffff, emissiveIntensity: 0.42, flatShading: true });
  const m = new THREE.Mesh(geo, mat);
  m.position.y = h / 2;
  const g = new THREE.Group(); g.add(m);
  const NEON = [0xff2d9a, 0x35e8ff, 0xff9a1a, 0x8a5cff, 0x2dff9a];
  const trimCol = NEON[(seed * 3 + Math.floor(w + d)) % NEON.length];
  const trim = new THREE.Mesh(new THREE.BoxGeometry(w + 0.5, 0.5, d + 0.5), glow(trimCol)); trim.position.y = h + 0.1; g.add(trim);     // glowing roof edge
  if (h > 40) { const band = new THREE.Mesh(new THREE.BoxGeometry(w + 0.3, 0.35, d + 0.3), glow(trimCol)); band.position.y = h * 0.55; g.add(band); }
  if (h > 24) {                                        // rooftop antenna with red blinker
    const ant = new THREE.Mesh(new THREE.BoxGeometry(0.3, 6, 0.3), flat(0x666677)); ant.position.y = h + 3; g.add(ant);
    const led = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.7), glow(0xff3030)); led.position.y = h + 6.2; g.add(led);
  }
  return g;
}

const BOARD_TEXTS = [['NEO RUSH', 0x6a1bd6, 0xd6247a], ['FAST !!!', 0x1b3fd6, 0x2a9fd6], ['CYBER TRONIC', 0x1b1b66, 0x7a1bd6], ['TURBO', 0xd66a1b, 0xd6247a], ['SPEED', 0x0d7a6a, 0x2a5fd6],
  ['NITRO', 0x0b4fd6, 0x35e8ff], ['DRIFT KINGS', 0xd6241b, 0xff9a1a], ['OCTANE', 0xd69a1b, 0xd6241b], ['TUNER SHOP', 0x7a1bd6, 0x1bd6c0]];
/** Billboard on two poles, turned to face `facing` ({x,z}). */
export function billboard(x, z, facing, rand) {
  const [text, c1, c2] = BOARD_TEXTS[Math.floor(rand() * BOARD_TEXTS.length)];
  const W = 15, H = 5.6, g = new THREE.Group();
  const board = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshBasicMaterial({ map: billboardTexture(text, c1, c2), side: THREE.DoubleSide }));
  board.position.y = 8; g.add(board);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(W + 0.8, H + 0.8, 0.4), glow(0x1a1040)); frame.position.set(0, 8, -0.3); g.add(frame);
  for (const sx of [-4.5, 4.5]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.5, 8, 0.5), flat(0x33334a)); p.position.set(sx, 4, -0.3); g.add(p); }
  g.position.set(x, 0, z);
  g.rotation.y = Math.atan2(facing.x - x, facing.z - z);
  return g;
}

/** Canyon cliff: stacked, narrowing slabs in layered rock colours. */
export function cliff(colors, rand) {
  const g = new THREE.Group();
  const tiers = 3 + Math.floor(rand() * 3);
  let w = 26 + rand() * 24, d = 20 + rand() * 20, y = 0;
  for (let i = 0; i < tiers; i++) {
    const h = 7 + rand() * 8;
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), flat(colors[(i + Math.floor(rand() * 2)) % colors.length]));
    m.position.set((rand() - 0.5) * 3, y + h / 2, (rand() - 0.5) * 3); m.rotation.y = (rand() - 0.5) * 0.35;
    g.add(m); y += h; w *= 0.72; d *= 0.72;
  }
  return g;
}

/** Oil derrick: wireframe pyramid tower with a pump head. */
export function derrick() {
  const g = new THREE.Group();
  const tower = new THREE.Mesh(new THREE.ConeGeometry(3.2, 17, 4, 3), new THREE.MeshBasicMaterial({ color: 0x2a2024, wireframe: true }));
  tower.position.y = 8.5; tower.rotation.y = Math.PI / 4; g.add(tower);
  const top = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 1.2), flat(0x3a2a2e)); top.position.y = 17.4; g.add(top);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(7, 0.7, 0.7), flat(0x5a3a2e)); arm.position.set(0, 4.5, 0); arm.rotation.z = 0.3; g.add(arm);
  return g;
}

/** Yellow warning diamond on a pole. */
export function warningSign(facing, x, z) {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.BoxGeometry(0.25, 3.4, 0.25), flat(0x444444)); pole.position.y = 1.7; g.add(pole);
  const sign = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.7, 0.15), glow(0xffcc1a)); sign.rotation.z = Math.PI / 4; sign.position.y = 3.6; g.add(sign);
  const mark = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.9, 0.2), glow(0x111111)); mark.position.set(0, 3.7, 0.02); g.add(mark);
  g.position.set(x, 0, z); g.rotation.y = Math.atan2(facing.x - x, facing.z - z);
  return g;
}

/** Stack of old tyres. */
export function tyreStack() {
  const g = new THREE.Group(), geo = new THREE.CylinderGeometry(0.8, 0.8, 0.55, 8), mat = flat(0x1c1c1f);
  for (let i = 0; i < 3; i++) { const t = new THREE.Mesh(geo, mat); t.position.set(i === 2 ? 0.2 : 0, 0.28 + i * 0.55, 0); g.add(t); }
  return g;
}

/** Neon arch (city) or tunnel (desert) over the road. kind: 'gantry' | 'tunnel'. */
export function overpass(kind, width, length, th) {
  const g = new THREE.Group();   // local frame: +z = travel direction, centred
  const wall = flat(th.tunnelColor ?? 0x2a2a3a);
  const H = kind === 'tunnel' ? 9 : 11;
  if (kind === 'tunnel') {
    const roof = new THREE.Mesh(new THREE.BoxGeometry(width + 10, 1.4, length), wall); roof.position.y = H; g.add(roof);
    for (const sx of [-1, 1]) {
      const side = new THREE.Mesh(new THREE.BoxGeometry(2.5, H, length), wall); side.position.set(sx * (width / 2 + 4.2), H / 2, 0); g.add(side);
    }
    for (let z = -length / 2 + 4; z < length / 2; z += 8) {         // ceiling lights
      const l = new THREE.Mesh(new THREE.BoxGeometry(width * 0.5, 0.2, 0.8), glow(0xffb43a)); l.position.set(0, H - 0.8, z); g.add(l);
    }
  } else {
    for (const sx of [-1, 1]) {
      const pil = new THREE.Mesh(new THREE.BoxGeometry(1.6, H, 1.6), flat(0x2a2a45)); pil.position.set(sx * (width / 2 + 3.5), H / 2, 0); g.add(pil);
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.4, H, 0.4), glow(sx < 0 ? 0xff3bd0 : 0x35e8ff)); strip.position.set(sx * (width / 2 + 2.6), H / 2, 0); g.add(strip);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(width + 9, 2.6, 1.6), flat(0x1c1c34)); beam.position.y = H; g.add(beam);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(width * 0.8, 2.2), new THREE.MeshBasicMaterial({ map: billboardTexture('NEO RUSH', 0x6a1bd6, 0xd6247a), side: THREE.DoubleSide }));
    sign.position.set(0, H, 0.9); g.add(sign);
    const sign2 = sign.clone(); sign2.position.z = -0.9; g.add(sign2);
  }
  return g;
}

// ---------- animated sky agents ----------
/**
 * Hovering police cars / helicopters circling over the track.
 * Returns an update(timeSeconds) function. spec: { kind: 'hover'|'heli', count }
 */
export function skyAgents(track, spec) {
  const agents = [];
  const n = track.n;
  for (let i = 0; i < spec.count; i++) {
    const g = new THREE.Group();
    if (spec.kind === 'heli') {
      const body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.8, 6), flat(0x3d4a3a)); g.add(body);
      const tail = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 5), flat(0x3d4a3a)); tail.position.z = -5; g.add(tail);
      const rotor = new THREE.Mesh(new THREE.BoxGeometry(11, 0.12, 0.7), flat(0x111111)); rotor.position.y = 1.2; g.add(rotor);
      g.userData.rotor = rotor;
    } else {
      const body = new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.9, 8), flat(0x2a3050)); g.add(body);
      const cab = new THREE.Mesh(new THREE.BoxGeometry(3, 0.7, 3), flat(0x7a8ab0)); cab.position.y = 0.7; g.add(cab);
      const red = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 0.9), glow(0xff2a2a)); red.position.set(-1.2, 1.2, 0); g.add(red);
      const blue = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 0.9), glow(0x2a6aff)); blue.position.set(1.2, 1.2, 0); g.add(blue);
      g.userData.red = red; g.userData.blue = blue;
    }
    // searchlight beam
    const beam = new THREE.Mesh(new THREE.ConeGeometry(7, 34, 8, 1, true), new THREE.MeshBasicMaterial({ color: spec.kind === 'heli' ? 0xfff0c0 : 0x9fd0ff, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }));
    beam.position.y = -17; g.add(beam);
    g.userData.phase = i / spec.count; g.userData.lat = (i % 2 ? 1 : -1) * (6 + i * 4);
    track.group.add(g); agents.push(g);
  }
  return t => {
    for (const g of agents) {
      const f = ((t * (spec.speed ?? 0.012) + g.userData.phase) % 1 + 1) % 1;
      const i = Math.floor(f * n) % n, j = (i + 1) % n, p = track.pts[i], q = track.pts[j], tn = track.tangents[i];
      g.position.set(p.x + tn.z * g.userData.lat, track.elev[i] + (spec.height ?? 26) + Math.sin(t * 0.7 + g.userData.phase * 9) * 2, p.z - tn.x * g.userData.lat);
      g.rotation.y = Math.atan2(q.x - p.x, q.z - p.z);
      g.rotation.z = Math.sin(t * 0.5 + g.userData.phase * 5) * 0.08;
      if (g.userData.rotor) g.userData.rotor.rotation.y = t * 25;
      if (g.userData.red) { const on = Math.floor(t * 4 + g.userData.phase * 10) % 2 === 0; g.userData.red.visible = on; g.userData.blue.visible = !on; }
    }
  };
}

// ---------- street city pieces (track theme `street`) ----------
const shopCache = new Map();
/** Ground-floor shop front: lit display windows with mullions and a door. Variant 0..3. */
function shopTexture(v) {
  if (shopCache.has(v)) return shopCache.get(v);
  const cv = document.createElement('canvas'); cv.width = 128; cv.height = 32;
  const g = cv.getContext('2d');
  const warm = ['#ffd9a0', '#bfe6ff', '#ffc0e0', '#e0ffd0'][v % 4];
  g.fillStyle = '#16161c'; g.fillRect(0, 0, 128, 32);
  for (let x = 4; x < 124; x += 30) {
    const gr = g.createLinearGradient(0, 6, 0, 30); gr.addColorStop(0, warm); gr.addColorStop(1, '#3a3430');
    g.fillStyle = gr; g.fillRect(x, 6, 24, 24);
    g.fillStyle = '#16161c'; g.fillRect(x + 11, 6, 2, 24); g.fillRect(x, 16, 24, 1);
  }
  g.fillStyle = '#2a2a33'; g.fillRect(0, 0, 128, 4);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  shopCache.set(v, t);
  return t;
}
const facadeMats = new Map();
function facadeMat(base, seed) {
  const key = base + ':' + seed;
  if (!facadeMats.has(key)) {
    const tx = windowTextures(base, seed);
    facadeMats.set(key, new THREE.MeshLambertMaterial({ map: tx.map, emissiveMap: tx.emissive, emissive: 0xffffff, emissiveIntensity: 0.38, flatShading: true }));
  }
  return facadeMats.get(key);
}
const SHOP_SIGNS = [['PIZZA', 0xd6241b, 0xff9a1a], ['HOTEL', 0x1b3fd6, 0x7a1bd6], ['BAR', 0x7a1bd6, 0xd6247a], ['CAFE', 0x6a3a1b, 0xd69a1b], ['SUSHI', 0xd6241b, 0x1b1b66],
  ['24/7', 0x0d7a6a, 0x2a9fd6], ['KEBAB', 0xd66a1b, 0xd6241b], ['TUNING', 0x1b1b1b, 0xff7a1a], ['GARAGE', 0x2a2a3a, 0x1b6ad6], ['CLUB', 0xd6247a, 0x35e8ff], ['NOODLES', 0xd69a1b, 0xd6241b]];

/**
 * City block building facing the road. d = depth (local x), h = height, fl = frontage along the road (local z).
 * roadSide = +1 / -1: which local x side faces the street (gets the shop front, awning and sign).
 */
export function streetBuilding(d, h, fl, base, seed, roadSide, rand) {
  const g = new THREE.Group();
  const geo = new THREE.BoxGeometry(d, h + 2, fl);
  scaleUV(geo, d, fl, h, 4);
  const main = new THREE.Mesh(geo, facadeMat(base, seed)); main.position.y = h / 2 - 1; g.add(main);
  // ground floor shops
  const shop = new THREE.Mesh(new THREE.BoxGeometry(d + 0.3, 3.4, fl + 0.3), new THREE.MeshBasicMaterial({ map: shopTexture(seed), color: 0xb0b0b0 }));
  shop.material.map.wrapS = THREE.RepeatWrapping; shop.position.y = 1.7; g.add(shop);
  // roof parapet and the odd rooftop box
  const parapet = new THREE.Mesh(new THREE.BoxGeometry(d + 0.4, 0.6, fl + 0.4), flat(0x1c1c24)); parapet.position.y = h + 0.3; g.add(parapet);
  if (rand() < 0.5) { const ac = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.4, 2.4), flat(0x50545e)); ac.position.set((rand() - 0.5) * d * 0.5, h + 1.2, (rand() - 0.5) * fl * 0.5); g.add(ac); }
  // awning + shop sign on the street side
  const sx = roadSide * (d / 2 + 0.9);
  const awnCol = [0x8a1a22, 0x1a4a8a, 0x1a6a3a, 0x2a2a30][Math.floor(rand() * 4)];
  const awn = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.15, fl * 0.7), flat(awnCol)); awn.position.set(sx, 3.6, 0); awn.rotation.z = roadSide * 0.25; g.add(awn);
  if (rand() < 0.7) {
    const [text, c1, c2] = SHOP_SIGNS[Math.floor(rand() * SHOP_SIGNS.length)];
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(fl * 0.6, 8), 1.6), new THREE.MeshBasicMaterial({ map: billboardTexture(text, c1, c2), color: 0xb8b8b8 }));
    sign.position.set(roadSide * (d / 2 + 0.25), 4.9, 0); sign.rotation.y = roadSide * Math.PI / 2; g.add(sign);
  }
  return g;
}

/** Traffic light on a pole with an arm over the road; `facing` rotation is set by the caller. */
export function trafficLight(t) {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.18, 6.5, 6), flat(0x3a3d46)); pole.position.y = 3.25; g.add(pole);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 4.5), flat(0x3a3d46)); arm.position.set(0, 6.3, 2.2); g.add(arm);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.7, 2.0, 0.6), flat(0x15161a)); head.position.set(0, 5.4, 4.3); g.add(head);
  const lamps = [0xff2a1a, 0xffb21a, 0x2aff6a].map((c, k) => {
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.45, 0.1), new THREE.MeshBasicMaterial({ color: 0x222222 }));
    l.position.set(0, 6.05 - k * 0.65, 4.3 + 0.32); l.userData.on = c; g.add(l); return l;
  });
  g.userData.phase = t;
  g.userData.lamps = lamps;
  return g;
}
/** Cycle the traffic lights (green -> amber -> red), time in seconds. */
export function updateLights(list, time) {
  for (const g of list) {
    const p = ((time + g.userData.phase) % 12);
    const on = p < 6 ? 2 : p < 7.5 ? 1 : 0;
    g.userData.lamps.forEach((l, k) => l.material.color.setHex(k === on ? l.userData.on : 0x1c1c1c));
  }
}

let _stripe = null;
/** Red / white striped road block across a closed side street. */
export function barricade(width) {
  if (!_stripe) {
    const cv = document.createElement('canvas'); cv.width = 64; cv.height = 8;
    const g = cv.getContext('2d'); for (let x = 0; x < 64; x += 8) { g.fillStyle = (x / 8) % 2 ? '#f2f2f2' : '#d42020'; g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 8, 0); g.lineTo(x + 4, 8); g.lineTo(x - 4, 8); g.fill(); }
    _stripe = new THREE.CanvasTexture(cv); _stripe.colorSpace = THREE.SRGBColorSpace; _stripe.wrapS = THREE.RepeatWrapping;
  }
  const g = new THREE.Group();
  const tex = _stripe.clone(); tex.repeat.set(width / 4, 1); tex.needsUpdate = true;
  const bar = new THREE.Mesh(new THREE.BoxGeometry(width, 0.6, 0.2), new THREE.MeshLambertMaterial({ map: tex, emissive: 0x222222 })); bar.position.y = 1.0; g.add(bar);
  for (const x of [-width / 2 + 0.4, width / 2 - 0.4]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1.0, 0.6), flat(0x2a2a30)); leg.position.set(x, 0.5, 0); g.add(leg);
    const blink = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), glow(0xffa21a)); blink.position.set(x, 1.5, 0); g.add(blink);
  }
  return g;
}

/** Small street tree in a planter. */
export function streetTree(rand) {
  const g = new THREE.Group();
  const pot = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.5, 1.4), flat(0x3a3a40)); pot.position.y = 0.25; g.add(pot);
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 2.6, 5), flat(0x4a3424)); trunk.position.y = 1.6; g.add(trunk);
  const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(1.6 + rand() * 0.6, 0), flat([0x1f5a32, 0x2a6a3a, 0x24502e][Math.floor(rand() * 3)])); crown.position.y = 3.6; g.add(crown);
  return g;
}

/** Street lamp: pole with an arm reaching over the kerb. Arm points along local +x. */
export function streetLamp(color) {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 7, 6), flat(0x3a3d46)); pole.position.y = 3.5; g.add(pole);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.12, 0.12), flat(0x3a3d46)); arm.position.set(1.0, 6.9, 0); g.add(arm);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.22, 0.45), glow(color)); head.position.set(2.0, 6.8, 0); g.add(head);
  return g;
}
