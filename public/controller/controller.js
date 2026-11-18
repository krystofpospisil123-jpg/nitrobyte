// Phone controller. Sends ONLY inputs (steer, throttle, brake, drift, turbo) ~50x per second.
// No game logic here. It also shows a little status from the game (speed, position, lap, boost, coins)
// and vibrates on events (Android; iPhone has no vibration API).

// ---- tunables (the user can change tilt range / mode / invert in the settings sheet) ----
const SEND_HZ = 50;
const DEAD_ZONE_DEG = 2.5;   // ignore tiny angles around the centre
const CURVE = 1.35;          // >1 = gentler near the centre, full lock at the edge (finer control)
const SMOOTH_SLOW = 0.18;    // smoothing for small movements (steady) ...
const SMOOTH_FAST = 0.6;     // ... and for fast ones (responsive)

const $ = id => document.getElementById(id);
const state = { steer: 0, throttle: 0, brake: 0, drift: false, turbo: false };
const store = {
  get(k, d) { try { const v = localStorage.getItem('nitrobyte.pad.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('nitrobyte.pad.' + k, JSON.stringify(v)); } catch { /* private mode */ } },
};
const cfg = { rot: store.get('rot', 'auto'), tilt: store.get('tilt', 42), mode: store.get('mode', 'tilt'), invert: store.get('invert', false), vibe: store.get('vibe', true), dir: store.get('dir2', 0) };   // dir: learned steering sign (0 = not learned yet)

let pair = '';                 // 4-digit code of the PC this phone belongs to (QR link ?pair=1234 or typed in)
let rawAngle = 0;            // current wheel angle in degrees (+ = clockwise = right)
let centerAngle = 0;         // calibration offset
let smoothed = 0;
let touchSteer = 0;          // value of the touch slider (-1..1)
let gotSensor = false, centered = false;

// pair code from the QR link, else the last one used
pair = (new URLSearchParams(location.search).get('pair') || store.get('pair', '') || '').replace(/\D/g, '').slice(0, 4);
$('pairin').value = pair;

// =====================================================================================
// iPhone zoom guards: a double tap (or pinch) must never zoom the page, or the buttons end up off-screen.
// =====================================================================================
const viewportMeta = document.querySelector('meta[name=viewport]');
const VIEWPORT = viewportMeta.content;
let guardsOn = false;          // enabled after the first tap on "connect" (that tap must stay a normal click)
let lastTouchEnd = 0;
document.addEventListener('gesturestart', e => e.preventDefault());           // Safari pinch
document.addEventListener('gesturechange', e => e.preventDefault());
document.addEventListener('gestureend', e => e.preventDefault());
document.addEventListener('dblclick', e => e.preventDefault());
document.addEventListener('touchstart', e => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
document.addEventListener('touchmove', e => { if (guardsOn && !(e.target.closest && e.target.closest('#sheet .card'))) e.preventDefault(); }, { passive: false });   // the settings list may scroll
document.addEventListener('touchend', e => {                                  // two taps within 350 ms = double-tap zoom
  const t = Date.now();
  if (guardsOn && t - lastTouchEnd < 350) e.preventDefault();
  lastTouchEnd = t;
}, { passive: false });
document.addEventListener('contextmenu', e => e.preventDefault());             // no long-press menu

/** If the page ever ends up zoomed anyway, reset it (re-applying the viewport meta makes Safari snap back). */
function resetZoom() {
  viewportMeta.content = 'width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';
  window.scrollTo(0, 0);
}
function checkZoom() {
  const vv = window.visualViewport;
  const zoomed = vv && vv.scale > 1.02;
  $('zoomwarn').style.display = zoomed ? 'block' : 'none';
  if (zoomed) resetZoom();
}
if (window.visualViewport) { visualViewport.addEventListener('resize', checkZoom); visualViewport.addEventListener('scroll', checkZoom); }
$('zoomwarn').addEventListener('pointerdown', () => { resetZoom(); setTimeout(checkZoom, 150); });

// =====================================================================================
// connection
// =====================================================================================
// First try WebSocket. Some phone browsers (iPhone Safari) refuse WebSocket to a server with a
// self-signed certificate even after the page was allowed. Then we fall back to HTTPS requests,
// which work because the page itself already loaded over the same certificate.
let ws = null, slot = null;
let transport = 'ws';          // 'ws' | 'http'
let httpToken = null, httpBusy = false;

let baseStatus = 'připojování…';
const setStatus = t => { $('status').textContent = t; };

function welcome(m) {
  slot = m.slot;
  document.body.style.background = `linear-gradient(#0b0d22 82%, ${m.color})`;
  baseStatus = `Hráč ${m.slot + 1}` + (transport === 'http' ? ' · HTTPS' : '');
  setStatus(centered || cfg.mode === 'touch' ? baseStatus : 'Drž telefon rovně jako volant…');
}

/** Messages from the game: status for the screen, vibration patterns. */
function onGameMessage(m) {
  if (m.t === 'stat') showStat(m);
  else if (m.t === 'vibe' && cfg.vibe && navigator.vibrate) navigator.vibrate(m.p);
}

function openWs() {
  if (transport !== 'ws') return;
  setStatus('připojování (WebSocket)…');
  try { ws = new WebSocket(`wss://${location.host}/ws?role=controller&pair=${pair}`); }
  catch { return switchToHttp(); }
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.t === 'welcome') welcome(m);
    else if (m.t === 'full') setStatus('Hra je plná (max 4)');
    else if (m.t === 'badpair') badPair();
    else onGameMessage(m);
  };
  ws.onclose = () => {
    if (transport !== 'ws') return;
    if (slot === null) return switchToHttp();          // never got in -> WebSocket is blocked
    setStatus('odpojeno, zkouším znovu…'); slot = null; setTimeout(openWs, 1000);
  };
  setTimeout(() => { if (transport === 'ws' && slot === null) switchToHttp(); }, 3000);   // safety net
}

/** Unknown pair code: go back to the start screen so it can be typed again. */
function badPair() {
  transport = 'stop';
  if (ws) { ws.onclose = null; try { ws.close(); } catch {} ws = null; }
  $('start').style.display = 'flex';
  $('err').textContent = 'Špatný nebo neznámý kód. Zkontroluj čtyřčíslí na obrazovce hry v PC.';
}

function switchToHttp() {
  if (transport === 'http' || transport === 'stop') return;
  transport = 'http';
  if (ws) { ws.onclose = null; try { ws.close(); } catch {} ws = null; }
  joinHttp();
}

async function joinHttp() {
  setStatus('připojování (HTTPS)…');
  try {
    const r = await fetch('/api/join', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pair }) });
    const m = await r.json();
    if (m.bad) return badPair();
    if (m.full) { setStatus('Hra je plná (max 4)'); return setTimeout(joinHttp, 3000); }
    httpToken = m.token;
    welcome(m);
  } catch (e) {
    setStatus('Nelze se spojit se serverem: ' + e.message);
    setTimeout(joinHttp, 2000);
  }
}

/** Send one input sample over whichever transport is active. */
function sendInput(msg) {
  if (transport === 'ws') {
    if (ws && ws.readyState === 1 && slot !== null) ws.send(JSON.stringify(msg));
    return;
  }
  if (!httpToken || httpBusy) return;                  // one request at a time = natural rate limit
  httpBusy = true;
  fetch('/api/input', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...msg, token: httpToken }) })
    .then(async r => {
      if (r.status === 410) { httpToken = null; slot = null; joinHttp(); return; }
      const body = await r.json().catch(() => null);   // the reply carries queued messages from the game
      if (body && body.msgs) body.msgs.forEach(onGameMessage);
    })
    .catch(() => setStatus('spojení kolísá…'))
    .finally(() => { httpBusy = false; });
}

// =====================================================================================
// status from the game
// =====================================================================================
function showStat(s) {
  $('speed').firstChild.nodeValue = s.speed;
  const inGame = s.screen === 'game';
  if (!inGame) {                                       // phone is also the menu controller
    $('pos').innerHTML = 'MENU <span>nakloň = změna · plyn = OK</span>';
  } else if (s.state === 'lobby') {
    $('pos').innerHTML = '– <span></span>';
  } else {
    $('pos').innerHTML = `${s.pos}/${s.n} <span>kolo ${s.lap}/${s.laps}</span>`;
  }
  $('coinsrow').textContent = `● ${s.coins}  (celkem ${s.wallet})`;
  $('meterfill').style.width = (s.boost ? 100 : s.meter * 100) + '%';
  $('meter').classList.toggle('full', !s.boost && s.meter >= 0.25);
  $('meter').classList.toggle('fire', !!s.boost);
}

// =====================================================================================
// motion sensor
// =====================================================================================
// Wheel angle from the gravity vector, independent of which landscape side the phone is rotated to.
let side = null;                // which landscape side the phone is held on: 90 (top to the left) or 270 (top to the right)
let flipCount = 0;

/**
 * Show the pad rotated when the OS is in portrait (see CSS: forced landscape).
 * The side we hold the phone on decides the direction; cfg.rot can force it.
 */
function updateRotation() {
  const portrait = innerHeight > innerWidth;
  const dir = cfg.rot === 'cw' ? 'cw' : cfg.rot === 'ccw' ? 'ccw' : (side === 270 ? 'ccw' : 'cw');
  const root = document.documentElement;
  root.classList.toggle('rotp', portrait);
  root.classList.toggle('cw', portrait && dir === 'cw');
  root.classList.toggle('ccw', portrait && dir === 'ccw');
}
addEventListener('resize', updateRotation);
addEventListener('orientationchange', () => setTimeout(updateRotation, 100));

// Smallest signed difference between two angles in degrees, result in -180..180.
const angDiff = (a, b) => { let d = a - b; while (d > 180) d -= 360; while (d < -180) d += 360; return d; };
let lastTheta = null, stillCount = 0, centerSide = null, dirCount = 0;

/**
 * Wheel angle = direction of the gravity vector inside the screen plane (x, y of the device).
 * Turning the phone like a steering wheel rotates that direction directly, so this does not depend on how the OS
 * rotated the screen (landscape, portrait, upside down). Clockwise wheel turn = positive angle = steer right.
 *
 * Centre: the first moment the phone is held roughly landscape (gravity mostly along the long edge) and still for
 * ~0.4 s. That way the centre is never taken while tapping the connect button in some random pose.
 */
function onMotion(e) {
  const a = e.accelerationIncludingGravity;
  if (!a || a.x == null) return;
  gotSensor = true;
  // iOS reports the gravity direction, Android the opposite (reaction force). Normalise to "down" vector.
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const sgn = ios ? 1 : -1;
  const dx = a.x * sgn, dy = a.y * sgn, g = Math.hypot(dx, dy);
  if (g < 3) return;                                       // phone nearly flat: the in-plane angle is meaningless, keep the last value

  if (Math.abs(dx) > 0.6 * g) {                            // which landscape side (only used to rotate the pad when the OS is in portrait)
    const s = dx < 0 ? 90 : 270;
    if (s !== side) { side = s; updateRotation(); }
  }
  const theta = Math.atan2(dy, dx) * 180 / Math.PI;
  rawAngle = theta;

  // Phone turned over to the other landscape side (top left <-> top right): the old centre is 180 degrees off,
  // so wait for it to be held still again and take a new centre automatically.
  if (centered && Math.abs(dx) > 0.8 * g) {
    const s = dx < 0 ? 90 : 270;
    if (centerSide === null) centerSide = s;
    if (s !== centerSide) { if (++flipCount > 30) { centered = false; centerSide = s; flipCount = 0; stillCount = 0; } } else flipCount = 0;
  }
  if (!centered) {                                         // wait for "landscape and still", then take the centre
    const landscape = Math.abs(dx) > 0.8 * g;
    const moving = lastTheta !== null && Math.abs(angDiff(theta, lastTheta)) > 1.5;
    stillCount = landscape && !moving ? stillCount + 1 : 0;
    if (stillCount > 25) { centerAngle = theta; centered = true; centerSide = dx < 0 ? 90 : 270; smoothed = 0; setStatus(baseStatus); }
    else if (stillCount === 0) setStatus('Drž telefon rovně jako volant…');
  }
  // learn the steering direction once: after centring, the player turns the phone to the RIGHT like a wheel
  if (centered && !cfg.dir && cfg.mode !== 'touch') {
    const d = angDiff(theta, centerAngle);
    dirCount = Math.abs(d) > 22 ? dirCount + Math.sign(d) : 0;
    if (Math.abs(dirCount) >= 8) { cfg.dir = Math.sign(dirCount); store.set('dir2', cfg.dir); dirCount = 0; setStatus('Směr nastaven ✔'); setTimeout(() => setStatus(baseStatus), 1500); }
    else setStatus('Otoč telefon jako volant DOPRAVA ➜');
  }
  lastTheta = theta;
}

async function enableSensors() {
  if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
    const r = await DeviceMotionEvent.requestPermission();
    if (r !== 'granted') throw new Error('Přístup k senzorům byl zamítnut. Zavři stránku a zkus znovu (Nastavení → Safari → Pohyb a orientace).');
  }
  addEventListener('devicemotion', onMotion);
}

// =====================================================================================
// UI wiring
// =====================================================================================
$('go').onclick = async () => {
  pair = ($('pairin').value || '').replace(/\D/g, '').slice(0, 4);
  store.set('pair', pair);
  if (transport === 'stop') { transport = 'ws'; slot = null; }          // retry after a wrong code
  $('err').textContent = '';
  try { await enableSensors(); } catch (e) { $('err').textContent = e.message; /* touch mode still works */ }
  $('start').style.display = 'none';
  guardsOn = true;                                     // from now on double taps are blocked
  try { await document.documentElement.requestFullscreen?.(); } catch {}
  try { await navigator.wakeLock?.request('screen'); } catch {}
  applyMode();
  openWs();
  setTimeout(() => { if (!gotSensor) { cfg.mode = 'touch'; applyMode(); } }, 1500);   // no sensor -> touch slider
};

/** Press-and-hold buttons with pointer events (multi-touch safe: gas + drift + turbo at once). */
function hold(id, key, analog) {
  const el = $(id);
  const set = v => { state[key] = v; el.classList.toggle('on', !!v); };
  el.addEventListener('pointerdown', e => { e.preventDefault(); try { el.setPointerCapture(e.pointerId); } catch {} set(analog ? 1 : true); });
  const up = () => set(analog ? 0 : false);
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('lostpointercapture', up);
}
hold('gas', 'throttle', true); hold('brake', 'brake', true); hold('drift', 'drift', false); hold('turbo', 'turbo', false);

// small buttons use pointerdown (a 'click' could be eaten by the double-tap guard)
const tap = (id, fn) => $(id).addEventListener('pointerdown', e => { e.preventDefault(); fn(); });
tap('center', () => { centerAngle = rawAngle; centered = true; smoothed = 0; setStatus(baseStatus); });
tap('gear', () => $('sheet').classList.add('open'));
const closeSheet = () => $('sheet').classList.remove('open');
tap('close', closeSheet); tap('close2', closeSheet);
$('sheet').addEventListener('pointerdown', e => { if (e.target.id === 'sheet') closeSheet(); });   // tap outside the card closes it
tap('recenter', () => { centerAngle = rawAngle; centered = true; smoothed = 0; setStatus(baseStatus); $('sheet').classList.remove('open'); });

function applyMode() {
  document.body.classList.toggle('touchmode', cfg.mode === 'touch');
  $('mode').textContent = cfg.mode === 'tilt' ? 'NÁKLON' : 'DOTYK';
  $('mode').classList.toggle('on', cfg.mode === 'touch');
  $('invert').textContent = cfg.invert ? 'ZAPNUTO' : 'VYPNUTO'; $('invert').classList.toggle('on', cfg.invert);
  $('rot').textContent = cfg.rot === 'auto' ? 'AUTO' : cfg.rot === 'cw' ? '↻ DOPRAVA' : '↺ DOLEVA'; $('rot').classList.toggle('on', cfg.rot !== 'auto');
  $('vibe').textContent = cfg.vibe ? 'ZAPNUTO' : 'VYPNUTO'; $('vibe').classList.toggle('on', cfg.vibe);
  $('tiltval').textContent = cfg.tilt + '°';
}
tap('mode', () => { cfg.mode = cfg.mode === 'tilt' ? 'touch' : 'tilt'; store.set('mode', cfg.mode); applyMode(); });
tap('recal', () => { cfg.dir = 0; store.set('dir2', 0); dirCount = 0; setStatus('Otoč telefon jako volant DOPRAVA ➜'); });
tap('invert', () => { cfg.invert = !cfg.invert; store.set('invert', cfg.invert); applyMode(); });
tap('rot', () => { cfg.rot = cfg.rot === 'auto' ? 'cw' : cfg.rot === 'cw' ? 'ccw' : 'auto'; store.set('rot', cfg.rot); applyMode(); updateRotation(); });
tap('vibe', () => { cfg.vibe = !cfg.vibe; store.set('vibe', cfg.vibe); applyMode(); if (cfg.vibe && navigator.vibrate) navigator.vibrate(60); });
tap('tminus', () => { cfg.tilt = Math.max(20, cfg.tilt - 4); store.set('tilt', cfg.tilt); applyMode(); });   // smaller angle = more sensitive
tap('tplus', () => { cfg.tilt = Math.min(70, cfg.tilt + 4); store.set('tilt', cfg.tilt); applyMode(); });
applyMode();
updateRotation();

// Touch slider fallback: drag on the lower part of the wheel area, springs back to centre on release
const slider = $('slider');
function sliderMove(e) {
  const r = slider.getBoundingClientRect(), root = document.documentElement;
  let f;                                                 // 0..1 along the slider's own (unrotated) x axis
  if (root.classList.contains('cw')) f = (e.clientY - r.top) / r.height;
  else if (root.classList.contains('ccw')) f = 1 - (e.clientY - r.top) / r.height;
  else f = (e.clientX - r.left) / r.width;
  touchSteer = Math.max(-1, Math.min(1, f * 2 - 1));
}
slider.addEventListener('pointerdown', e => { e.preventDefault(); try { slider.setPointerCapture(e.pointerId); } catch {} sliderMove(e); });
slider.addEventListener('pointermove', e => { if (slider.hasPointerCapture(e.pointerId)) sliderMove(e); });
const sliderUp = () => { touchSteer = 0; };
slider.addEventListener('pointerup', sliderUp); slider.addEventListener('pointercancel', sliderUp);

// =====================================================================================
// send loop
// =====================================================================================
function computeSteer() {
  if (cfg.mode === 'touch') return touchSteer;
  if (!centered) return 0;                                // no centre yet -> no steering (avoids a random lock)
  if (!cfg.dir) return 0;                                 // direction not learned yet (see onMotion)
  let a = angDiff(rawAngle, centerAngle) * cfg.dir * (cfg.invert ? -1 : 1);
  const dz = DEAD_ZONE_DEG;
  a = Math.abs(a) < dz ? 0 : a - Math.sign(a) * dz;       // dead zone without a jump at its edge
  let t = Math.max(-1, Math.min(1, a / (cfg.tilt - dz)));
  t = Math.sign(t) * Math.pow(Math.abs(t), CURVE);        // response curve: fine near the centre
  const k = SMOOTH_SLOW + (SMOOTH_FAST - SMOOTH_SLOW) * Math.min(1, Math.abs(t - smoothed) * 3);   // quick moves pass through quickly
  smoothed += (t - smoothed) * k;
  return smoothed;
}

setInterval(() => {
  const steer = computeSteer();
  if ($('sheet').classList.contains('open')) $('angle').textContent = `${Math.round(angDiff(rawAngle, centerAngle))}° (střed ${Math.round(centerAngle)}°, volant ${steer.toFixed(2)})`;
  $('wheel').style.transform = `rotate(${(steer * 85).toFixed(1)}deg)`;
  if (cfg.mode === 'touch') $('knob').style.left = `${50 + steer * 46}%`;
  sendInput({ t: 'input', steer: +steer.toFixed(3), throttle: state.throttle, brake: state.brake, drift: state.drift, turbo: state.turbo });
}, 1000 / SEND_HZ);
