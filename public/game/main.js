// Game entry point: scene, main loop, driver list, race flow, HUD, networking glue.
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { Track } from './track.js';
import { Driver, PhoneController, KeyboardController, NEUTRAL_INPUT } from './drivers.js';
import { BotController } from './bot.js';
import { Race } from './race.js';
import { connect } from './net.js';
import { Effects } from './fx.js';
import { Hud } from './hud.js';
import { Menu, loadSettings } from './menu.js';
import { Car } from './car.js';
import { profile, addCoins, lookOf, perks } from './profile.js';
import { CATALOG, REWARDS, FINISH_REWARD } from './catalog.js';
import { sfx, music, setVolumes, isMuted } from './sfx.js';
import { Online, cleanName, cleanLook } from './online.js';
import { Post } from './post.js';
import { makeSky } from './scenery.js';
import './tune.js';
import city from './tracks/city.js';
import forest from './tracks/forest.js';
import desert from './tracks/desert.js';
import downtown from './tracks/downtown.js';

// Register tracks here: they appear in the race setup menu in this order
const $ = id => document.getElementById(id);
let camInit = false;                      // true once the chase camera has been placed (declared early: used by loadTrack)
const TRACK_LIST = [city, downtown, forest, desert];
let track = new Track(TRACK_LIST[0]);
let trackNo = 0;

// ---------- renderer / scene ----------
const canvas = document.getElementById('c');
const urlQ = new URLSearchParams(location.search).get('q');       // ?q=0..3 pins the graphics quality (0 = best)
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0, CONFIG.render.fogNear, CONFIG.render.fogFar);
const ambient = new THREE.AmbientLight(0xffffff, 1.4);
const sun = new THREE.DirectionalLight(0xffffff, 2.0);
sun.position.set(60, 100, 40);
scene.add(ambient, sun);
scene.add(track.group);
const camera = new THREE.PerspectiveCamera(CONFIG.camera.fov, 1, 0.5, 2500);
const post = new Post(renderer, scene, camera);                   // bloom, speed blur, colour grade
if (urlQ != null) post.level = Math.max(0, Math.min(3, +urlQ | 0));
const pmrem = new THREE.PMREMGenerator(renderer);
const envCache = new Map();
applyTheme(track.data.theme);

/** Reflection map for the wet road: a dark sky with ring of neon bars (what the asphalt "reflects"). */
function neonEnv(th, key) {
  if (envCache.has(key)) return envCache.get(key);
  const s = new THREE.Scene();
  s.add(makeSky(th));
  const cols = th.neon || [0xff2d9a, 0x35e8ff, 0xff9a1a, 0x8a5cff];
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2, tall = 4 + (i * 7 % 5) * 5;
    const m = new THREE.Mesh(new THREE.BoxGeometry(10 + (i % 3) * 8, tall, 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(cols[i % cols.length]).multiplyScalar(2.5) }));
    m.position.set(Math.cos(a) * 110, 6 + (i % 4) * 9, Math.sin(a) * 110); m.lookAt(0, 6, 0); s.add(m);
  }
  const tex = pmrem.fromScene(s, 0.03, 0.1, 2500).texture;
  envCache.set(key, tex);
  return tex;
}

/** Sky, fog, lights, bloom and (for wet night streets) the road reflections come from the track's theme. */
function applyTheme(th) {
  scene.background = new THREE.Color(th.sky);
  scene.fog.color.set(th.fog);
  scene.fog.near = th.fogNear ?? CONFIG.render.fogNear;
  scene.fog.far = th.fogFar ?? CONFIG.render.fogFar;
  ambient.color.set(th.ambient); ambient.intensity = th.ambientI ?? 1.4;
  sun.color.set(th.sun); sun.intensity = th.sunI ?? 2.0;
  Car.night = !!th.night;
  post.setLook({ bloom: th.bloom ?? 0.6, threshold: th.bloomThreshold ?? 0.65, grade: th.grade ?? 1, vignette: th.vignette ?? 0.35 });
  scene.environment = th.wet ? neonEnv(th, track.data.id) : null;
}

const effects = new Effects(scene);          // sparks, smoke, skid marks
const hud = new Hud();                       // dials, position, minimap
hud.setTrack(track, 1);

let viewW = 1, viewH = 1;
const SCALES = [0.85, 0.85, 0.7, 0.6];                      // render scale per quality level (0 = best)
function resize() {
  // Render below native resolution (bloom + grade are the expensive part); CSS scales the canvas to the window
  const sc = SCALES[post.level];
  const w = Math.floor(innerWidth * sc);
  const h = Math.floor(innerHeight * sc);
  renderer.setPixelRatio(1);
  renderer.setSize(w, h, false);
  post.setSize(w, h);
  viewW = w; viewH = h;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// ---------- drivers ----------
const drivers = [];                       // every car on the track (humans + bots)
const driverById = new Map();
const race = new Race(track, drivers);
let rocketHuman = false;                  // a human got the rocket start -> show it in the banner
race.onEvent = (type, d, place) => {
  if (type === 'rocket' && isLocalHuman(d)) rocketHuman = true;
  if (type === 'finish' && isLocalHuman(d)) {                      // coins for the finishing position
    const scale = Math.max(0.5, Math.min(2, race.totalLaps / 3));         // longer races pay more
    d.reward = Math.max(5, Math.round((REWARDS[place - 1] ?? FINISH_REWARD) * scale / 5) * 5);
    addCoins(d.reward); sfx.reward();
  }
};
const isLocalHuman = d => d.kind === 'human' && !d.remote;     // driven from this PC (phone / keyboard)
const localHuman = () => drivers.find(isLocalHuman);
const cssHex = n => '#' + n.toString(16).padStart(6, '0');

const BOT_COLORS = ['#b05cff', '#ff8fd0', '#9aa5b8', '#5ce0d0', '#ff9a3c', '#c0ff4a', '#8a6bff'];
const BOT_NAMES = ['Rex', 'Nova', 'Bolt', 'Zed', 'Pixel', 'Turbo', 'Vega'];
const MAX_CARS = 8;                        // grid size
const settings = loadSettings();          // chosen in the menu, remembered between runs
let paused = false;

/** The first human drives the garage car (look + upgrades); other humans get plain cars in their slot colour. */
function applyProfile() {
  drivers.filter(isLocalHuman).forEach((d, i) => {
    if (i === 0) { d.look = lookOf(); d.color = cssHex(d.look.color); d.car.perk = perks(); }
    else { d.look = Car.defaultLook(d.baseColor, i); d.color = d.baseColor; d.car.perk = { speed: 1, accel: 1, turbo: 1 }; }
    d.car.setLook(d.look);
  });
  renderPlayers();
}

/** Random cosmetics so the bots do not all look alike. */
function botLook(i) {
  const pick = a => a[Math.floor(Math.random() * a.length)];
  return {
    color: parseInt(BOT_COLORS[i % BOT_COLORS.length].slice(1), 16), body: pick(CATALOG.body).id,
    skin: Math.random() < 0.45 ? 'none' : pick(CATALOG.skin).id, wing: pick(CATALOG.wing).value,
    rims: pick(CATALOG.rims).value, glow: Math.random() < 0.5 ? null : pick(CATALOG.glow).value, flame: pick(CATALOG.flame).value,
  };
}

// Garage showroom: a display car on the road just ahead of the start line
let showcase = null;
function showShowcase(look) {
  if (!showcase) { showcase = new Car(look); scene.add(showcase.mesh); } else showcase.setLook(look);
  if (showcase._track !== track) {
    const i = (track.data.start.index + Math.round(22 / track.spacing)) % track.n, p = track.pts[i], t = track.tangents[i];
    showcase.place(p.x, p.z, Math.atan2(t.x, t.z), track.elev[i]); showcase._track = track;
  }
  showcase.mesh.visible = true;
}
function hideShowcase() { if (showcase) showcase.mesh.visible = false; }

function addDriver(opts) {
  const d = new Driver({ style: drivers.length, ...opts });
  d.placeOnGrid(track, drivers.length);
  scene.add(d.car.mesh);
  drivers.push(d);
  driverById.set(d.id, d);
  if (isLocalHuman(d)) applyProfile(); else renderPlayers();
  return d;
}
function removeDriver(id) {
  const d = driverById.get(id);
  if (!d) return;
  scene.remove(d.car.mesh);
  drivers.splice(drivers.indexOf(d), 1);
  driverById.delete(id);
  if (isLocalHuman(d)) applyProfile(); else renderPlayers();
}

/** Start (or restart) a race with the menu settings: refill the grid with bots, then countdown. */
function startRace() {
  if (race.state === 'countdown' || race.state === 'racing') return;
  [...drivers].filter(d => d.kind === 'bot').forEach(d => removeDriver(d.id));   // fresh bots each race
  if (!drivers.some(isLocalHuman)) { settings.keyboard = true; setKeyboard(true); menu?.render(); }   // nobody connected -> play on keyboard
  const humans = drivers.length;
  const botCount = Math.max(0, Math.min(settings.bots, MAX_CARS - humans));
  const preset = CONFIG.difficulties[settings.difficulty];
  CONFIG.bots.preset = preset;
  for (let i = 0; i < botCount; i++) {
    addDriver({
      id: 'bot' + i, name: 'Bot ' + BOT_NAMES[i % BOT_NAMES.length], color: BOT_COLORS[i % BOT_COLORS.length],
      kind: 'bot', look: botLook(i), controller: new BotController(track, preset, 0.97 + Math.random() * 0.06),
    });
  }
  race.laps = settings.laps;
  rocketHuman = false;
  track.resetCoins();
  applyProfile();
  race.start();
  $('results').hidden = true;
  $('panel').hidden = true;
  camInit = false;
}

/** Keyboard player on/off (used by the menu and as automatic fallback). */
function setKeyboard(on) {
  if (on && !driverById.has('kb')) addDriver({ id: 'kb', name: 'Klávesnice', color: '#ff9a3c', kind: 'human', controller: new KeyboardController() });
  if (!on) removeDriver('kb');
}

/** Back to the setup menu: remove bots, park everybody on the grid. */
function quitToMenu() {
  paused = false;
  race.state = 'lobby';
  [...drivers].filter(d => d.kind === 'bot' || d.remote).forEach(d => removeDriver(d.id));
  drivers.forEach((d, i) => d.placeOnGrid(track, i));
  $('results').hidden = true;
  if (online.active) { if (online.isHost) online.send({ k: 'lobby' }); menu.show('lobby'); }
  else menu.show('setup');
}

/** Swap the whole track (only allowed between races). */
function loadTrack(no) {
  if (race.state === 'countdown' || race.state === 'racing') return;
  if (no === trackNo && track.group.parent) return;
  trackNo = no;
  scene.remove(track.group);
  track = new Track(TRACK_LIST[no]);
  scene.add(track.group);
  applyTheme(track.data.theme);
  hud.setTrack(track, no + 1);
  race.track = track;
  race.state = 'lobby';
  $('results').hidden = true;
  drivers.forEach((d, i) => d.placeOnGrid(track, i));      // park everybody on the new grid
  camInit = false;
}

// ---------- networking: phones join as drivers ----------
const online = new Online(o => net.send(o));
const REMOTE_CTL = { getInput: () => NEUTRAL_INPUT };      // remote cars are moved by network states, not by input
const net = connect({
  onMsg: m => online.handle(m),
  onClose: () => onlineLost(),
  onJoin: m => {
    const id = 'phone' + m.slot;
    if (driverById.has(id)) return;
    if (driverById.has('kb')) { setKeyboard(false); settings.keyboard = false; menu?.render(); toast('Telefon připojen – klávesnice vypnuta'); }   // a phone replaces the keyboard player
    addDriver({ id, name: 'Hráč ' + (m.slot + 1), color: m.color, kind: 'human', controller: new PhoneController() });
  },
  onLeave: m => removeDriver('phone' + m.slot),
  onInput: m => { const d = driverById.get('phone' + m.slot); if (d) d.controller.receive(m); },
});

/** Send a message to a phone (status for its screen, vibration). Only phone drivers have a slot. */
function toPhone(d, data) { if (d.id.startsWith('phone')) net.send({ t: 'to', slot: +d.id.slice(5), data }); }
const buzz = (d, pattern) => toPhone(d, { t: 'vibe', p: pattern });

function applyAudio() { setVolumes({ music: settings.music, sfx: settings.sfx }); }
function toast(text) { const t = $('toast'); t.textContent = text; t.classList.remove('show'); void t.offsetWidth; t.classList.add('show'); }

// ---------- menu ----------
const menu = new Menu({
  tracks: TRACK_LIST, settings,
  cb: {
    onTrack: no => loadTrack(no),
    onKeyboard: on => setKeyboard(on),
    onStart: () => { if (online.active) hostStart(); else { startRace(); menu.show('game'); } },
    isOnline: () => online.active,
    isHost: () => online.isHost,
    onlineCreate: name => { myName = cleanName(name); online.create(myName, lookOf()); },
    onlineJoin: (code, name) => { myName = cleanName(name); online.join(code, myName, lookOf()); },
    onLeaveRoom: () => leaveOnline(),
    onResume: () => { paused = false; menu.show('game'); },
    onRestart: () => { paused = false; race.state = 'lobby'; startRace(); menu.show('game'); },
    onQuit: quitToMenu,
    onAudio: applyAudio,
    onScreen: s => {                                                  // music follows the screen
      if (s === 'title' || s === 'setup' || s === 'garage' || s === 'online' || s === 'lobby') music.play('menu');
      if (s === 'lobby') { renderLobby(); if (online.isHost) sendCfg(); }
      else if (s === 'game') { music.play(track.data.id); music.duck(false); }
      else if (s === 'pause') music.duck(true);
      if (s !== 'game') sfx.silence();
    },
    garage: {
      open: () => showShowcase(lookOf()),
      preview: look => showShowcase(look),
      changed: () => applyProfile(),
      close: () => { hideShowcase(); applyProfile(); },
    },
  },
});
applyAudio();
if (settings.track) loadTrack(settings.track);
if (settings.keyboard) setKeyboard(true);

addEventListener('keydown', e => {
  if (menu.key(e)) { e.preventDefault(); return; }
  if (e.target && e.target.tagName === 'INPUT') return;                  // typing a name / code
  if (e.code === 'KeyM') { setVolumes({ muted: !isMuted() }); toast(isMuted() ? 'ZVUK VYPNUTÝ' : 'ZVUK ZAPNUTÝ'); return; }
  if (e.code === 'KeyP') $('panel').hidden = !$('panel').hidden;
  if (menu.screen !== 'game') return;
  if (e.code === 'Escape' && (race.state === 'countdown' || race.state === 'racing')) { paused = !online.active; menu.show('pause'); }   // online: the race keeps running
  else if (race.state === 'results') {
    if (e.code === 'Enter') { if (online.active) { if (online.isHost) hostStart(); } else startRace(); }       // same settings again
    else if (e.code === 'Escape') quitToMenu();
  }
});
$('results').addEventListener('click', () => { if (online.active) { if (online.isHost) hostStart(); } else startRace(); });

// ---------- UI ----------
/** QR code + address for phones; the link carries this PC's pair code so the phone controls THIS game page. */
function refreshInfo() {
  fetch('/api/info?pair=' + online.pair).then(r => r.json()).then(info => {
    for (const id of ['qr', 'menuqr', 'lobbyqr']) $(id).src = info.qr;
    for (const id of ['url', 'menuurl']) $(id).textContent = info.url;
    for (const id of ['paircode', 'lobbypair']) $(id).textContent = online.pair ? 'kód: ' + online.pair : '';
  });
}
online.on.hello = () => refreshInfo();
refreshInfo();
function renderPlayers() {
  const html = drivers.length ? drivers.map(d => `<div><span class="dot" style="background:${d.color}"></span>${d.name}</div>`).join('') : '<div style="color:#8a90c0">zatím nikdo</div>';
  $('players').innerHTML = html; $('menuplayers').innerHTML = html;
}
let flashTimer;
function flash(text) { $('banner').className = 'small'; $('banner').textContent = text; clearTimeout(flashTimer); flashTimer = setTimeout(() => { $('banner').textContent = ''; flashTimer = 0; }, 2500); }

const fmt = s => `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, '0')}`;
const ord = p => p + '.';

let lastResultsKey = '';
let lastBanner = '';
function updateUI(focus) {
  // Banner: lobby hint / countdown / GO
  const banner = $('banner');
  let html = '', cls = '';
  if (race.state === 'countdown') html = `<span class="cd">${Math.ceil(race.countdown)}</span>`;
  else if (race.state === 'racing' && race.time < 1.5) html = '<span class="cd go">GO!</span>' + (rocketHuman ? '<br><span class="rocket">RAKETOVÝ START!</span>' : '');
  if (html !== lastBanner) { lastBanner = html; banner.className = cls; banner.innerHTML = html; }

  hud.update({ focus, race, drivers, coins: focus ? { total: profile.coins, run: focus.runCoins } : null });
  const racing = race.state !== 'lobby';
  $('standings').innerHTML = racing && race.order
    ? race.order.map(d => `<div class="${d === focus ? 'me' : ''}">${ord(d.place)} <span class="dot" style="background:${d.color}"></span>${d.name}${d.finished ? ' ✔' : ''}</div>`).join('') : '';

  // Results table
  if (race.state === 'results') {
    const key = race.order.map(d => d.id + d.finished + d.reward + d.runCoins).join();
    if (key !== lastResultsKey) {
      lastResultsKey = key;
      $('results').hidden = false;
      $('results').innerHTML = '<b style="font-size:34px">VÝSLEDKY</b><table>' + race.order.map(d =>
        `<tr><td>${ord(d.place)}</td><td><span class="dot" style="background:${d.color}"></span>${d.name}</td><td>${d.finished ? fmt(d.finishTime) : 'v jízdě'}</td></tr>`).join('') +
        '</table><div class="rewards">' + race.order.filter(d => d.kind === 'human' && !d.remote).map(d => `${d.name}: ● ${d.runCoins} sebráno` + (d.finished ? ` · odměna za umístění +${d.reward}` : '')).join('<br>') + `<br>Celkem mincí: ● ${profile.coins}</div>` +
        '<div style="font-size:16px;margin-top:10px">ENTER / klik = další závod · ESC = menu · M = ztlumit zvuk</div>';
    }
  } else lastResultsKey = '';
}

// ---------- camera (follows the first human driver) ----------
let fov = CONFIG.camera.fov;
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
function updateCamera(dt, target, now) {
  if (menu.screen === 'garage' && showcase) {                         // orbit the showroom car, shifted to the right half of the screen
    const c = showcase, a = now * 0.00035;
    camera.position.set(c.x + Math.cos(a) * 8, c.base + 2.7, c.z + Math.sin(a) * 8);
    camera.lookAt(c.x, c.base + 0.9, c.z);
    camera.setViewOffset(viewW, viewH, -viewW * 0.2, 0, viewW, viewH);
    camera.fov = CONFIG.camera.fov; camera.updateProjectionMatrix();
    camInit = false;
    return;
  }
  if (camera.view && camera.view.enabled) { camera.clearViewOffset(); camera.updateProjectionMatrix(); }
  if (menu.screen === 'title' || menu.screen === 'setup') {          // slow orbit around the start line behind the menu
    const p = track.pts[track.data.start.index], a = now * 0.00016;
    const gy = track.elev[track.data.start.index];
    camera.position.set(p.x + Math.cos(a) * 24, gy + 7 + Math.sin(a * 2) * 1.5, p.z + Math.sin(a) * 24);
    camera.lookAt(p.x, gy + 1.5, p.z);
    camera.fov = CONFIG.camera.fov; camera.updateProjectionMatrix();
    camInit = false;
    return;
  }
  if (!target) { camera.position.set(0, 30, 40); camera.lookAt(0, 0, 0); return; }
  const c = target.car, C = CONFIG.camera;
  const fx = Math.sin(c.heading), fz = Math.cos(c.heading);
  const wantPos = new THREE.Vector3(c.x - fx * C.distance, c.base + C.height + c.y * 0.6, c.z - fz * C.distance);
  const wantLook = new THREE.Vector3(c.x + fx * C.lookAhead, c.base + 1.2 + c.y * 0.5, c.z + fz * C.lookAhead);
  const k = camInit ? 1 - Math.exp(-C.followSpeed * dt) : 1;   // frame-rate independent smoothing
  camPos.lerp(wantPos, k); camLook.lerp(wantLook, k);
  camInit = true;
  // turbo widens the field of view for a speed-rush feel
  const wantFov = C.fov + Math.min(1, Math.abs(c.speed) / CONFIG.car.maxSpeed) * 6 + (c.turboTime > 0 ? CONFIG.turbo.fovBoost : 0);
  fov += (wantFov - fov) * (1 - Math.exp(-6 * dt));
  camera.fov = fov; camera.updateProjectionMatrix();
  camera.position.copy(camPos);
  camera.lookAt(camLook);
  if (race.state === 'racing') {                                   // engine rumble: a little shake that grows with speed and boost
    const sh = (Math.max(0, Math.abs(c.speed) / CONFIG.car.maxSpeed - 0.5) * 0.05 + (c.turboTime > 0 ? 0.07 : 0)) * (c.airborne ? 0 : 1);
    camera.position.x += (Math.random() - 0.5) * sh; camera.position.y += (Math.random() - 0.5) * sh;
  }
}

// ---------- online play ----------
let myName = (() => { try { return localStorage.getItem('nitrobyte.name') || ''; } catch { return ''; } })() || 'Hráč' + (10 + Math.floor(Math.random() * 90));
let netAt = 0, lastCfg = null;

/** Lobby screen: room code, who is in, hint for host / guest. */
function renderLobby() {
  $('roomcode').textContent = online.code || '----';
  const rows = [{ id: online.you, name: myName + ' (ty)', look: lookOf() }, ...online.peers.values()];
  $('lobbylist').innerHTML = rows.map(p => `<div class="row lobbyrow"><span><span class="dot" style="background:${cssHex(p.look ? p.look.color : 0xffffff)}"></span>${(p.name || 'Hráč').replace(/</g, '&lt;')}</span>` +
    `<span class="badge ${p.id === online.hostId ? 'cost' : 'own'}">${p.id === online.hostId ? '★ HOSTITEL' : 'HRÁČ'}</span></div>`).join('');
  const cfg = online.isHost ? { track: settings.track, laps: settings.laps, bots: settings.bots, diff: settings.difficulty } : lastCfg;
  const summary = cfg ? `${TRACK_LIST[cfg.track].name} · ${cfg.laps} kola · ${cfg.bots} botů · ${CONFIG.difficulties[cfg.diff].name}` : '';
  $('lobbyhint').innerHTML = (summary ? `<b style="color:#ffd21a">${summary}</b><br>` : '') +
    (online.isHost ? 'Pošli kamarádům adresu a kód místnosti.<br>ENTER = nastavení a start závodu · ESC = opustit místnost'
                   : 'Čekáš, až hostitel spustí závod…<br>ESC = opustit místnost') +
    `<br><br>Adresa hry pro kamarády: <b>${location.origin}/game/</b>`;
}
function sendCfg() { online.send({ k: 'cfg', track: settings.track, laps: settings.laps, bots: settings.bots, diff: settings.difficulty }); }

online.on.room = () => {
  if (menu.screen === 'online') menu.show('lobby');                 // created / joined: show the lobby
  else if (menu.screen === 'lobby') { renderLobby(); if (online.isHost) sendCfg(); }
  renderPlayers();
};
online.on.error = msg => menu.onlineMsg(msg, true);
online.on.peerLeft = id => { removeDriver('p' + id); if (race.state === 'racing') toast('Hráč odešel'); };
/** The host left and WE are the new host: take over the bots (they continue from where the old host's last update left them). */
online.on.host = () => {
  if (!online.isHost) return;
  let took = 0;
  for (const d of drivers) {
    if (!d.remote || d.kind !== 'bot') continue;
    d.remote = false;
    d.controller = new BotController(track, CONFIG.bots.preset, 0.97 + Math.random() * 0.06);
    d.trackIndex = track.project(d.car.x, d.car.z, -1).index;
    took++;
  }
  toast(took && race.state === 'racing' ? 'Hostitel odešel – jsi nový hostitel, boti jedou dál' : 'Jsi nový hostitel');
};
online.on.message = (from, data) => {
  const fromHost = from === online.hostId;
  if (data.k === 'st' && Array.isArray(data.list)) {                // car states: a player may only report its own car, the host also its bots
    for (const s of data.list.slice(0, 10)) {
      if (!s || !(s.id === from || (fromHost && typeof s.id === 'string' && s.id.startsWith('bot')))) continue;
      const d = drivers.find(x => x.remote && x.netId === s.id);
      if (!d) continue;
      const n = { t: performance.now() };
      let ok = true;
      for (const k of ['x', 'z', 'h', 'sp', 'vx', 'vz', 'y', 'b', 'gs', 'st', 'dr', 'tb', 'mt', 'air', 'lap', 'cp', 'pr', 'fin', 'ft']) { n[k] = +s[k] || 0; if (!Number.isFinite(n[k])) ok = false; }
      if (!ok) continue;
      d.net = n;
      if (n.fin && !d.finished) { d.finished = true; d.finishTime = n.ft; race.finishOrder.push(d); }
    }
  } else if (data.k === 'start' && fromHost) startOnlineRace(data);   // only the host starts races / sets the config
  else if (data.k === 'cfg' && fromHost) { lastCfg = { track: Math.max(0, Math.min(TRACK_LIST.length - 1, data.track | 0)), laps: Math.max(1, Math.min(10, data.laps | 0)), bots: Math.max(0, Math.min(7, data.bots | 0)), diff: Math.max(0, Math.min(CONFIG.difficulties.length - 1, data.diff | 0)) }; if (menu.screen === 'lobby') renderLobby(); }
  else if (data.k === 'lobby' && fromHost) { if (menu.screen === 'game' && race.state !== 'lobby') { race.state = 'lobby'; quitToMenu(); } }
};
/** Connection to the server lost while online: drop back to the title screen. */
function onlineLost() {
  if (!online.active) return;
  online.reset();
  [...drivers].filter(d => d.remote).forEach(d => removeDriver(d.id));
  race.state = 'lobby'; paused = false; $('results').hidden = true;
  menu.show('title'); toast('Spojení se serverem se přerušilo');
}
function leaveOnline() {
  online.leave();
  [...drivers].filter(d => d.remote || d.kind === 'bot').forEach(d => removeDriver(d.id));
  race.state = 'lobby'; paused = false; $('results').hidden = true;
  menu.show('title');
}

/** HOST: build the grid (everybody + bots), tell the others, and start here too. */
function hostStart() {
  const me = { id: online.you, kind: 'human', name: myName, look: lookOf() };
  const humans = [me, ...[...online.peers.values()].map(p => ({ id: p.id, kind: 'human', name: p.name, look: p.look || Car.defaultLook('#ffffff') }))];
  const nBots = Math.max(0, Math.min(settings.bots, MAX_CARS - humans.length));
  const bots = Array.from({ length: nBots }, (_, i) => ({ id: 'bot' + i, kind: 'bot', name: 'Bot ' + BOT_NAMES[i % BOT_NAMES.length], look: botLook(i) }));
  const msg = { k: 'start', track: settings.track, laps: settings.laps, diff: settings.difficulty, grid: [...humans, ...bots] };
  online.send(msg);
  startOnlineRace(msg);
}

/** EVERYBODY: build the same grid from the host's message and start the countdown. */
function startOnlineRace(msg) {
  if (race.state === 'countdown' || race.state === 'racing') return;
  if (!Array.isArray(msg.grid)) return;
  msg = {                                                                   // never trust the message shape: clamp everything
    track: Math.max(0, Math.min(TRACK_LIST.length - 1, msg.track | 0)), laps: Math.max(1, Math.min(10, msg.laps | 0)),
    diff: Math.max(0, Math.min(CONFIG.difficulties.length - 1, msg.diff | 0)),
    grid: msg.grid.slice(0, MAX_CARS).map(e => ({ id: e.id, kind: e.kind === 'bot' ? 'bot' : 'human', name: cleanName(e.name), look: cleanLook(e.look) })),
  };
  if (msg.grid.findIndex(e => e.id === online.you) < 0) return;              // we must be on the grid
  if (msg.track !== trackNo) loadTrack(msg.track);
  let local = localHuman();
  if (!local) { setKeyboard(true); local = driverById.get('kb'); }          // no phone connected -> keyboard
  [...drivers].forEach(d => { if (d !== local) removeDriver(d.id); });       // extra local players, bots and old remote cars
  local.netId = online.you; local.name = myName;
  const preset = CONFIG.difficulties[msg.diff] || CONFIG.difficulties[2];
  CONFIG.bots.preset = preset;
  const order = new Map([[local, msg.grid.findIndex(e => e.id === online.you)]]);
  msg.grid.forEach((e, i) => {
    if (e.id === online.you) return;
    const base = { name: e.name, color: cssHex(e.look.color), look: e.look, netId: e.id };
    let d;
    if (e.kind === 'human') d = addDriver({ ...base, id: 'p' + e.id, kind: 'human', controller: REMOTE_CTL, remote: true });
    else if (online.isHost) d = addDriver({ ...base, id: e.id, kind: 'bot', controller: new BotController(track, preset, 0.97 + Math.random() * 0.06) });
    else d = addDriver({ ...base, id: e.id, kind: 'bot', controller: REMOTE_CTL, remote: true });
    order.set(d, i);
  });
  drivers.sort((a, b) => order.get(a) - order.get(b));
  race.laps = msg.laps;
  rocketHuman = false;
  track.resetCoins();
  applyProfile();
  race.start();
  $('results').hidden = true; $('panel').hidden = true;
  camInit = false; paused = false;
  menu.show('game');
}

/** Broadcast the state of every car THIS machine simulates (our own, plus the bots if we are the host), ~20x per second. */
function sendNetState(now) {
  if (!online.active || race.state === 'lobby' || now - netAt < 50) return;
  netAt = now;
  const list = drivers.filter(d => !d.remote && d.netId != null).map(d => d.packState());
  if (list.length) online.send({ k: 'st', list });
}

// ---------- audio / haptics / phone status ----------
const fxPrev = { cd: 0, state: 'lobby', wallAt: 0, statAt: 0 };
function frameAudio(now, focus, dt) {
  const live = menu.screen === 'game' && !paused;
  // race flow sounds
  if (live) {
    if (race.state === 'countdown') {
      const n = Math.ceil(race.countdown);
      if (n !== fxPrev.cd) { fxPrev.cd = n; sfx.beep(); for (const d of drivers) buzz(d, [40]); }
    }
    if (fxPrev.state === 'countdown' && race.state === 'racing') { sfx.go(); for (const d of drivers) buzz(d, [200]); }
    if (fxPrev.state === 'racing' && race.state === 'results') { music.play('menu'); sfx.finish(); }
    fxPrev.state = race.state;
  }
  // engine + effects for the player's car
  const driving = live && (race.state === 'countdown' || race.state === 'racing');
  sfx.engine(focus && focus.car, driving);
  sfx.drift(!!(driving && focus && focus.car.drifting && !focus.car.airborne));
  // per-driver sounds and vibration
  for (const d of drivers) {
    const c = d.car, p = d._fx || (d._fx = { air: false, turbo: 0 });
    if (live && isLocalHuman(d)) {
      if (c.airborne && !p.air) { if (d === focus) sfx.jump(); }
      if (c.landed > 0.25) { if (d === focus) sfx.land(); buzz(d, [90, 30, 60]); }
      if (c.turboTime > 0 && p.turbo <= 0) { if (d === focus) sfx.boost(); buzz(d, [60, 30, 120]); }
      if (c.hitWall && now - fxPrev.wallAt > 250) { fxPrev.wallAt = now; if (d === focus) sfx.wall(); buzz(d, [80]); }
    }
    p.air = c.airborne; p.turbo = c.turboTime;
  }
  // status to the phones (about 5x per second): speed, position, lap, boost meter, coins
  if (now - fxPrev.statAt > 200) {
    fxPrev.statAt = now;
    for (const d of drivers) if (isLocalHuman(d)) toPhone(d, {
      t: 'stat', screen: menu.screen, state: race.state, speed: Math.round(Math.abs(d.car.speed) * 3.6), pos: d.place, n: drivers.length,
      lap: Math.min(d.lap + 1, race.totalLaps), laps: race.totalLaps, meter: +d.car.turboMeter.toFixed(2), boost: d.car.turboTime > 0,
      coins: d.runCoins, wallet: profile.coins,
    });
  }
}

// ---------- main loop ----------
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 1 / 20); // clamp so a lag spike cannot explode the physics
  last = now;
  menu.update(drivers.filter(isLocalHuman));
  const focus = localHuman() || drivers[0];
  if (!paused) {
    if (menu.screen === 'game') {
      for (const d of drivers) { if (d.remote) d.applyNet(dt); else d.update(dt, now, track, race.canDrive); }
      race.update(dt, now);
      sendNetState(now);
      if (race.state === 'racing') {                                  // humans collect coins
        for (const d of drivers) {
          if (!isLocalHuman(d) || d.finished) continue;
          for (const c of track.collectCoins(d.car.x, d.car.base + d.car.y + 1, d.car.z, now / 1000)) {
            d.runCoins += c.value; addCoins(c.value); effects.coin(c.x, c.y, c.z); buzz(d, [c.value > 1 ? 40 : 15]);
            if (d === localHuman()) sfx.coin(c.value > 1);
          }
        }
      }
    }
    updateCamera(dt, focus, now);
    for (const d of drivers) effects.driver(d, dt);
    effects.update(dt);
    track.update(now / 1000);
  }
  frameAudio(now, focus, dt);
  if (track.sky) track.sky.position.copy(camera.position);       // sky dome follows the camera
  updateUI(focus);
  // speed feel: radial blur grows with speed, turbo / boost pads blur + split the colours, a wall hit flashes
  const fc = focus && menu.screen === 'game' && race.state !== 'lobby' ? focus.car : null;
  const s01 = fc ? Math.min(1, Math.abs(fc.speed) / (CONFIG.car.maxSpeed + CONFIG.turbo.speedBonus)) : 0;
  fxBoost += ((fc && fc.turboTime > 0 ? 1 : 0) - fxBoost) * Math.min(1, dt * 8);
  fxHit = Math.max(0, fxHit - dt * 4); if (fc && fc.hitWall) fxHit = 1;
  post.render(now / 1000, s01, fxBoost, fxHit);
  governor(now);
}
let fxBoost = 0, fxHit = 0;

/** Adaptive quality: when the average frame takes > 30 ms, step down (bloom off, lower render scale, no blur...). */
let govN = 0, govSum = 0, govLast = 0, govSince = performance.now();
function governor(now) {
  const d = now - govLast; govLast = now;
  if (urlQ != null || now - govSince < 4000 || d > 120 || document.hidden) return;     // pinned, still warming up, or a hitch / hidden tab
  govSum += d; govN++;
  if (govN >= 150) {
    const avg = govSum / govN; govN = 0; govSum = 0;
    if (avg > 30 && post.level < 3) { post.level++; resize(); govSince = now; }
  }
}
requestAnimationFrame(frame);

// Debug handle for the browser console
if (new URLSearchParams(location.search).has('debug')) window.__game = { post, scene, camera, online, race, drivers, get track() { return track; }, startRace, loadTrack, menu, settings, effects, profile };
