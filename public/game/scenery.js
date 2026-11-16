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
  const mat = new THREE.MeshLambertMaterial({ map: tx.map, emissiveMap: tx.emissive, emissive: 0xffffff, emissiveIntensity: 0.9, flatShading: true });
  const m = new THREE.Mesh(geo, mat);
  m.position.y = h / 2;
  const g = new THREE.Group(); g.add(m);
  if (h > 24) {                                        // rooftop antenna with red blinker
    const ant = new THREE.Mesh(new THREE.BoxGeometry(0.3, 6, 0.3), flat(0x666677)); ant.position.y = h + 3; g.add(ant);
    const led = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.7), glow(0xff3030)); led.position.y = h + 6.2; g.add(led);
  }
  return g;
}

const BOARD_TEXTS = [['NEO RUSH', 0x6a1bd6, 0xd6247a], ['FAST !!!', 0x1b3fd6, 0x2a9fd6], ['CYBER TRONIC', 0x1b1b66, 0x7a1bd6], ['TURBO', 0xd66a1b, 0xd6247a], ['SPEED', 0x0d7a6a, 0x2a5fd6]];
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
