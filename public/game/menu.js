// Menus: title screen, race setup, garage and pause menu.
// Controls: keyboard (arrows / Enter / Esc), mouse (click rows and arrows) and phones
// (tilt = change value, brake / drift = previous / next row, gas = OK).
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { Garage } from './garage.js';
import { profile } from './profile.js';
import { sfx } from './sfx.js';

const $ = id => document.getElementById(id);

export const DEFAULT_SETTINGS = { track: 0, laps: 3, bots: 5, difficulty: 2, keyboard: false, music: 3, sfx: 4 };
const STORAGE_KEY = 'nitrobyte.settings';
const LAP_OPTIONS = [1, 2, 3, 5, 8];
const MAX_BOTS = 7;
const PAUSE_ITEMS = ['POKRAČOVAT', 'RESTART ZÁVODU', 'HLAVNÍ MENU'];
const TITLE_ITEMS = [{ id: 'race', label: '▶ ZÁVOD' }, { id: 'online', label: '◉ ONLINE' }, { id: 'garage', label: '◆ GARÁŽ' }];
const PAUSE_ONLINE = ['POKRAČOVAT', 'ODEJÍT ZE ZÁVODU'];

export function loadSettings() {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') }; }
  catch { return { ...DEFAULT_SETTINGS }; }
}
function saveSettings(s) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch { /* private mode etc. */ } }

export class Menu {
  /**
   * tracks: array of track data; settings: object persisted between runs.
   * cb: { onTrack(no), onKeyboard(on), onStart(), onResume(), onRestart(), onQuit(),
   *       onAudio(), onScreen(name), isOnline(), onlineCreate(name), onlineJoin(code, name), onLeaveRoom(), garage: { preview(look), changed(), open(), close() } }
   */
  constructor({ tracks, settings, cb }) {
    this.tracks = tracks; this.s = settings; this.cb = cb;
    this.screen = 'title';              // 'title' | 'setup' | 'garage' | 'online' | 'lobby' | 'game' | 'pause'
    this.sel = 0; this.pauseSel = 0; this.titleSel = 0;
    this.phoneState = new Map();        // driver id -> previous input, for edge detection
    this.rowDefs = [
      { id: 'track', label: 'TRAŤ' },
      { id: 'laps', label: 'KOLA' },
      { id: 'bots', label: 'BOTI' },
      { id: 'difficulty', label: 'OBTÍŽNOST BOTŮ' },
      { id: 'keyboard', label: 'KLÁVESNICE' },
      { id: 'music', label: 'HUDBA' },
      { id: 'sfx', label: 'ZVUKY' },
      { id: 'start', label: 'START ZÁVODU' },
    ];
    this._previews = tracks.map(t => Menu.outline(t));
    this.garage = new Garage({
      preview: look => cb.garage.preview(look),
      changed: () => { cb.garage.changed(); this.renderTitle(); },
      back: () => this.show('title'),
    });
    this._bind();
    this.show('title');
  }

  // ---------- screens ----------
  show(screen) {
    if (this.screen === 'garage' && screen !== 'garage') this.cb.garage.close();
    this.screen = screen;
    for (const id of ['menu', 'pause']) { const el = $(id); el.classList.remove('fresh'); void el.offsetWidth; el.classList.add('fresh'); }
    clearTimeout(this._freshTimer);
    this._freshTimer = setTimeout(() => { $('menu').classList.remove('fresh'); $('pause').classList.remove('fresh'); }, 900);
    const inMenu = ['title', 'setup', 'garage', 'online', 'lobby'].includes(screen);
    document.body.classList.toggle('inmenu', inMenu);        // hides the race HUD behind the menus
    $('menu').classList.toggle('hidden', !inMenu);
    for (const id of ['title', 'setup', 'garage', 'online', 'lobby']) $(id).classList.toggle('hidden', screen !== id);
    $('menu').classList.toggle('overcar', screen === 'garage');
    $('pause').classList.toggle('hidden', screen !== 'pause');
    if (screen === 'title') this.renderTitle();
    if (screen === 'setup') { this.sel = this.rowDefs.length - 1; this.render(); }
    if (screen === 'garage') { this.cb.garage.open(); this.garage.open(); }
    if (screen === 'pause') { this.pauseSel = 0; this.renderPause(); }
    if (screen === 'online') { $('omsg').textContent = ''; setTimeout(() => $('oname').focus(), 50); }
    if (screen !== 'online' && document.activeElement && document.activeElement.tagName === 'INPUT') document.activeElement.blur();
    if (this.cb.onScreen) this.cb.onScreen(screen);
  }

  // ---------- setting values ----------
  value(id) {
    const s = this.s;
    switch (id) {
      case 'track': return this.tracks[s.track].name;
      case 'laps': return String(s.laps);
      case 'bots': return String(s.bots);
      case 'difficulty': return CONFIG.difficulties[s.difficulty].name;
      case 'keyboard': return s.keyboard ? 'ZAPNUTÁ' : 'VYPNUTÁ';
      case 'music': return s.music ? '▮'.repeat(s.music) + '▯'.repeat(5 - s.music) : 'VYPNUTO';
      case 'sfx': return s.sfx ? '▮'.repeat(s.sfx) + '▯'.repeat(5 - s.sfx) : 'VYPNUTO';
    }
    return '';
  }

  change(id, dir) {
    const s = this.s;
    const wrap = (v, n) => (v + n) % n;
    switch (id) {
      case 'track': s.track = wrap(s.track + dir, this.tracks.length); this.cb.onTrack(s.track); break;
      case 'laps': s.laps = LAP_OPTIONS[wrap(LAP_OPTIONS.indexOf(s.laps) + dir, LAP_OPTIONS.length)]; break;
      case 'bots': s.bots = Math.max(0, Math.min(MAX_BOTS, s.bots + dir)); break;
      case 'difficulty': s.difficulty = wrap(s.difficulty + dir, CONFIG.difficulties.length); break;
      case 'keyboard': s.keyboard = !s.keyboard; this.cb.onKeyboard(s.keyboard); break;
      case 'music': s.music = Math.max(0, Math.min(5, s.music + dir)); break;
      case 'sfx': s.sfx = Math.max(0, Math.min(5, s.sfx + dir)); break;
      default: return;
    }
    saveSettings(s);
    if (id === 'music' || id === 'sfx') this.cb.onAudio();
    sfx.select();
    this._bump = this.sel;                                      // animate the changed value
    this.render();
  }

  /** OK / confirm: act on the current screen. */
  ok() {
    this._press();
    if (this.screen === 'title') { sfx.click(); const id = TITLE_ITEMS[this.titleSel].id; return this.show(id === 'garage' ? 'garage' : id === 'online' ? 'online' : 'setup'); }
    if (this.screen === 'lobby') { if (this.cb.isOnline() && this._isHost()) { sfx.click(); this.show('setup'); } return; }
    if (this.screen === 'pause') return this.pauseOk();
    if (this.screen === 'garage') return this.garage.ok();
    if (this.screen !== 'setup') return;
    if (this.rowDefs[this.sel].id === 'start') { saveSettings(this.s); sfx.start(); this.cb.onStart(); }
    else { sfx.click(); this.sel = Math.min(this.sel + 1, this.rowDefs.length - 1); this.render(); }
  }

  move(dir) {
    if (this.screen === 'title') { this.titleSel = (this.titleSel + dir + TITLE_ITEMS.length) % TITLE_ITEMS.length; sfx.select(); this.renderTitle(); }
    else if (this.screen === 'setup') { this.sel = (this.sel + dir + this.rowDefs.length) % this.rowDefs.length; sfx.select(); this.render(); }
    else if (this.screen === 'garage') this.garage.move(dir);
    else if (this.screen === 'pause') { const n = this.cb.isOnline() ? PAUSE_ONLINE.length : PAUSE_ITEMS.length; this.pauseSel = (this.pauseSel + dir + n) % n; this.renderPause(); }
  }

  /** Brief "pressed" animation on the selected row. */
  _press() {
    const el = document.querySelector('.screen:not(.hidden) .row.sel, #pause:not(.hidden) .row.sel');
    if (!el) return;
    el.classList.remove('press'); void el.offsetWidth; el.classList.add('press');
  }

  /** Left / right on the current row. */
  side(dir) {
    if (this.screen === 'setup') this.change(this.rowDefs[this.sel].id, dir);
    else if (this.screen === 'garage') this.garage.change(dir);
  }

  _isHost() { return this.cb.isHost ? this.cb.isHost() : false; }

  /** Message line on the online screen (errors in red). */
  onlineMsg(text, bad) { $('omsg').textContent = text; $('omsg').className = bad ? 'bad' : ''; if (bad) sfx.nope(); }

  back() {
    if (this.screen !== 'game') sfx.back();
    if (this.screen === 'setup') this.show(this.cb.isOnline() ? 'lobby' : 'title');
    else if (this.screen === 'garage' || this.screen === 'online') this.show('title');
    else if (this.screen === 'lobby') this.cb.onLeaveRoom();
    else if (this.screen === 'pause') this.cb.onResume();
  }

  pauseOk() {
    (this.cb.isOnline() ? [this.cb.onResume, this.cb.onQuit] : [this.cb.onResume, this.cb.onRestart, this.cb.onQuit])[this.pauseSel]();
  }

  // ---------- rendering ----------
  renderTitle() {
    $('titlemenu').innerHTML = TITLE_ITEMS.map((t, i) => `<div class="row${i === this.titleSel ? ' sel' : ''}" data-i="${i}">${t.label}</div>`).join('');
    $('titlecoins').textContent = '● ' + profile.coins;
  }

  render() {
    $('rows').innerHTML = this.rowDefs.map((r, i) => {
      const cls = 'row' + (i === this.sel ? ' sel' : '') + (r.id === 'start' ? ' start' : '');
      if (r.id === 'start') return `<div class="${cls}" data-i="${i}">▶ ${r.label}</div>`;
      return `<div class="${cls}" data-i="${i}"><span class="label">${r.label}</span>` +
        `<span class="val"><b class="arrow" data-dir="-1">◀</b><span class="txt${this._bump === i ? ' bump' : ''}">${this.value(r.id)}</span><b class="arrow" data-dir="1">▶</b></span></div>`;
    }).join('');
    this._bump = -1;
    // track preview + facts
    const t = this.tracks[this.s.track];
    this._drawPreview(t);
    const th = t.theme;
    $('trackname').textContent = t.name;
    $('trackinfo').innerHTML = `Délka ≈ ${this._previews[this.s.track].length} m · šířka ${t.width} m<br>` +
      `${(t.pads || []).length}× boost pad · ${(t.ramps || []).length}× skokánek` +
      `<br>převýšení ${this._previews[this.s.track].climb} m`;
    $('trackprev').style.borderColor = '#' + (th.kerb?.[0] ?? 0xff3b6b).toString(16).padStart(6, '0');
  }

  renderPause() {
    const items = this.cb.isOnline() ? PAUSE_ONLINE : PAUSE_ITEMS;
    $('pausemenu').innerHTML = items.map((t, i) => `<div class="row${i === this.pauseSel ? ' sel' : ''}" data-i="${i}">${t}</div>`).join('');
  }

  /** Build a closed outline of the track for the preview (+ height range from the elevation waves). */
  static outline(data) {
    const curve = new THREE.CatmullRomCurve3(data.points.map(([x, z]) => new THREE.Vector3(x, 0, z)), true, 'centripetal');
    const waves = (data.elevation && data.elevation.waves) || [];
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < 200; i++) {
      const h = waves.reduce((s, [f, a, ph]) => s + a * Math.sin(2 * Math.PI * (f * i / 200 + (ph || 0))), 0);
      lo = Math.min(lo, h); hi = Math.max(hi, h);
    }
    return { pts: curve.getSpacedPoints(160), length: Math.round(curve.getLength()), climb: Math.round(hi - lo) };
  }

  _drawPreview(t) {
    const cv = $('trackprev'), g = cv.getContext('2d'), W = cv.width, H = cv.height, pad = 26;
    const { pts } = this._previews[this.s.track], th = t.theme;
    const hex = c => '#' + c.toString(16).padStart(6, '0');
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, hex(th.skyTop ?? th.sky)); sky.addColorStop(1, hex(th.skyBottom ?? th.fog));
    g.fillStyle = sky; g.fillRect(0, 0, W, H);
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of pts) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); }
    const s = Math.min((W - 2 * pad) / (maxX - minX), (H - 2 * pad) / (maxZ - minZ));
    const map = p => [W / 2 + (p.x - (minX + maxX) / 2) * s, H / 2 + (p.z - (minZ + maxZ) / 2) * s];
    const path = () => { g.beginPath(); pts.forEach((p, i) => { const [x, y] = map(p); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.closePath(); };
    g.lineJoin = 'round'; g.lineCap = 'round';
    g.strokeStyle = '#000'; g.lineWidth = 16; path(); g.stroke();
    g.strokeStyle = hex(th.kerb?.[0] ?? 0xff3b6b); g.lineWidth = 12; path(); g.stroke();
    g.strokeStyle = hex(th.road?.[0] ?? 0x444444); g.lineWidth = 8; path(); g.stroke();
    const [sx, sy] = map(pts[0]);
    g.fillStyle = '#fff'; g.fillRect(sx - 5, sy - 5, 10, 10); g.fillStyle = '#000'; g.fillRect(sx - 2, sy - 2, 4, 4);
  }

  // ---------- input ----------
  _bind() {
    $('rows').addEventListener('click', e => {
      const row = e.target.closest('.row'); if (!row) return;
      const i = +row.dataset.i, arrow = e.target.closest('.arrow');
      this.sel = i;
      if (arrow) this.change(this.rowDefs[i].id, +arrow.dataset.dir);
      else if (this.rowDefs[i].id === 'start') this.ok();
      else this.render();
    });
    // hovering a row selects it (with a soft tick)
    const hover = (list, get, set, redraw) => list.addEventListener('mouseover', e => {
      const row = e.target.closest('.row'); if (!row || +row.dataset.i === get()) return;
      set(+row.dataset.i); sfx.hover(); redraw();
    });
    hover($('rows'), () => this.sel, i => { this.sel = i; }, () => this.render());
    hover($('titlemenu'), () => this.titleSel, i => { this.titleSel = i; }, () => this.renderTitle());
    hover($('pausemenu'), () => this.pauseSel, i => { this.pauseSel = i; }, () => this.renderPause());
    // online form
    const name = () => { const n = ($('oname').value || '').trim().slice(0, 16) || 'Hráč'; try { localStorage.setItem('nitrobyte.name', n); } catch {} return n; };
    const create = () => { sfx.click(); this.onlineMsg('Vytvářím místnost…'); this.cb.onlineCreate(name()); };
    const join = () => {
      const code = ($('ocode').value || '').trim().toUpperCase();
      if (code.length !== 4) return this.onlineMsg('Kód má 4 písmena', true);
      sfx.click(); this.onlineMsg('Připojuji…'); this.cb.onlineJoin(code, name());
    };
    $('ocreate').addEventListener('click', create);
    $('ojoin').addEventListener('click', join);
    $('oback').addEventListener('click', () => this.back());
    $('oname').addEventListener('keydown', e => { if (e.code === 'Enter') $('ocode').focus(); });
    $('ocode').addEventListener('keydown', e => { if (e.code === 'Enter') join(); });
    $('ocode').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, ''); });
    try { $('oname').value = localStorage.getItem('nitrobyte.name') || ''; } catch {}
    $('titlemenu').addEventListener('click', e => {
      const row = e.target.closest('.row'); if (!row) return;
      this.titleSel = +row.dataset.i; this.ok();
    });
    $('pausemenu').addEventListener('click', e => {
      const row = e.target.closest('.row'); if (!row) return;
      this.pauseSel = +row.dataset.i; this.pauseOk();
    });
  }

  /** Keyboard. Returns true when the key was used by a menu. */
  key(e) {
    if (this.screen === 'game') return false;
    const c = e.code;
    if (e.target && e.target.tagName === 'INPUT') {                   // typing a name / room code: only Esc leaves
      if (c === 'Escape') { e.target.blur(); this.back(); return true; }
      return false;
    }
    if (c === 'Enter' || c === 'Space' || c === 'NumpadEnter') this.ok();
    else if (c === 'ArrowUp' || c === 'KeyW') this.move(-1);
    else if (c === 'ArrowDown' || c === 'KeyS') this.move(1);
    else if (c === 'ArrowLeft' || c === 'KeyA') this.side(-1);
    else if (c === 'ArrowRight' || c === 'KeyD') this.side(1);
    else if (c === 'Escape' || c === 'Backspace') this.back();
    else return false;
    return true;
  }

  /** Phones as menu controllers. Call every frame with the connected human drivers. */
  update(humans) {
    const active = ['title', 'setup', 'garage', 'lobby'].includes(this.screen);   // pause / race ignore phones
    for (const d of humans) {
      const inp = d.controller.last; if (!inp) continue;       // keyboard driver has no .last
      const prev = this.phoneState.get(d.id) || { steer: 0, throttle: 0, brake: 0, drift: false };
      if (active) {
        if (Math.abs(inp.steer) > 0.6 && Math.abs(prev.steer) <= 0.4) this.side(inp.steer > 0 ? 1 : -1);
        if (inp.drift && !prev.drift) this.move(1);
        if (inp.brake > 0.5 && prev.brake <= 0.5) this.move(-1);
        if (inp.throttle > 0.5 && prev.throttle <= 0.5) this.ok();
      }
      this.phoneState.set(d.id, { ...inp });                   // always record, so held buttons do not fire later
    }
  }
}
