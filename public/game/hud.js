// HUD: position / time / lap boxes, speedometer dial, boost bar and a track minimap.
import { CONFIG } from './config.js';

const $ = id => document.getElementById(id);
const fmt = s => `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, '0')}`;

export class Hud {
  constructor() {
    this.dial = $('dial').getContext('2d');
    this.map = $('map').getContext('2d');
    this.boostSegs = [];
    const bar = $('boostbar');
    for (let i = 0; i < 12; i++) {
      const s = document.createElement('i');
      s.style.setProperty('--c', i < 4 ? '#ff3b3b' : i < 8 ? '#ff9a1a' : '#ffe14a');
      bar.appendChild(s); this.boostSegs.push(s);
    }
    this.mapBase = null;
  }

  /** Pre-render the track outline for the minimap. */
  setTrack(track, stageNo) {
    const W = 200, H = 170, pad = 14;
    const pts = track.pts;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of pts) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); }
    const s = Math.min((W - 2 * pad) / (maxX - minX), (H - 2 * pad) / (maxZ - minZ));
    const ox = W / 2 - ((minX + maxX) / 2) * s, oz = H / 2 - ((minZ + maxZ) / 2) * s;
    this.toMap = (x, z) => [x * s + ox, z * s + oz];
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    g.lineJoin = 'round'; g.lineCap = 'round';
    const path = () => { g.beginPath(); pts.forEach((p, i) => { const [x, y] = this.toMap(p.x, p.z); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.closePath(); };
    g.strokeStyle = '#000'; g.lineWidth = 10; path(); g.stroke();
    g.strokeStyle = '#8c90a8'; g.lineWidth = 6; path(); g.stroke();
    g.strokeStyle = '#d8dbea'; g.lineWidth = 2; path(); g.stroke();
    const [sx, sy] = this.toMap(pts[track.data.start.index].x, pts[track.data.start.index].z);
    g.fillStyle = '#fff'; g.fillRect(sx - 4, sy - 4, 8, 8); g.fillStyle = '#000'; g.fillRect(sx - 2, sy - 2, 4, 4);
    this.mapBase = cv;
    $('stage').textContent = `STAGE ${stageNo}`;
  }

  update({ focus, race, drivers, coins }) {
    const racing = race.state !== 'lobby';
    for (const id of ['posbox', 'lapbox', 'coinbox']) $(id).classList.toggle('hidden', !racing || !focus);
    if (focus) {
      if (racing) {
        $('pos').textContent = focus.place; $('poscount').textContent = '/' + drivers.length;
        $('time').textContent = fmt(Math.max(0, race.time));
        $('lap').textContent = Math.min(focus.lap + 1, race.totalLaps); $('laps').textContent = race.totalLaps;
      }
      if (coins) {
        if (coins.total !== this._lastCoins) { $('coins').textContent = coins.total; if (this._lastCoins !== undefined) { const b = $('coinbox'); b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop'); } this._lastCoins = coins.total; }
        $('coinsrun').textContent = coins.run ? '+' + coins.run : '';
      }
      this._speedo(focus.car);
      this._boost(focus.car);
    }
    this._minimap(drivers, focus);
  }

  _boost(car) {
    const bar = $('boostbar'), fire = car.turboTime > 0;
    bar.classList.toggle('fire', fire);
    const on = fire ? 12 : Math.ceil(car.turboMeter * 12 - 1e-6);
    this.boostSegs.forEach((s, i) => s.classList.toggle('on', i < on));
  }

  _speedo(car) {
    const g = this.dial, C = 115, R = 92;
    const kmh = Math.abs(car.speed) * 3.6, maxK = 240, f = Math.min(1, kmh / maxK);
    const A0 = Math.PI * 0.75, SWEEP = Math.PI * 1.5;
    g.clearRect(0, 0, 230, 230);
    // dark disc
    g.fillStyle = 'rgba(8,10,34,.82)'; g.beginPath(); g.arc(C, C, R + 12, 0, 7); g.fill();
    // coloured arc: cyan, red zone at the end
    g.lineWidth = 10;
    g.strokeStyle = '#35e8ff'; g.beginPath(); g.arc(C, C, R, A0, A0 + SWEEP * 0.75); g.stroke();
    g.strokeStyle = '#ff3b3b'; g.beginPath(); g.arc(C, C, R, A0 + SWEEP * 0.75, A0 + SWEEP); g.stroke();
    // ticks and numbers 0..8
    g.fillStyle = '#fff'; g.font = 'bold 15px "Courier New"'; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let i = 0; i <= 8; i++) {
      const a = A0 + SWEEP * i / 8;
      g.fillText(i, C + Math.cos(a) * (R - 20), C + Math.sin(a) * (R - 20));
    }
    // needle
    const a = A0 + SWEEP * f;
    g.strokeStyle = '#ff2a2a'; g.lineWidth = 4; g.beginPath(); g.moveTo(C - Math.cos(a) * 8, C - Math.sin(a) * 8); g.lineTo(C + Math.cos(a) * (R - 10), C + Math.sin(a) * (R - 10)); g.stroke();
    g.fillStyle = '#222'; g.beginPath(); g.arc(C, C, 7, 0, 7); g.fill();
    $('speed').textContent = Math.round(kmh);
    $('gearnum').textContent = Math.max(1, Math.min(6, 1 + Math.floor(kmh / 40)));
  }

  _minimap(drivers, focus) {
    if (!this.mapBase) return;
    const g = this.map;
    g.clearRect(0, 0, 200, 170);
    g.drawImage(this.mapBase, 0, 0);
    for (const d of drivers) {
      const [x, y] = this.toMap(d.car.x, d.car.z), me = d === focus, r = me ? 6 : 4;
      g.fillStyle = '#000'; g.fillRect(x - r - 1, y - r - 1, 2 * r + 2, 2 * r + 2);
      g.fillStyle = d.color; g.fillRect(x - r, y - r, 2 * r, 2 * r);
      if (me) { g.strokeStyle = '#fff'; g.lineWidth = 2; g.strokeRect(x - r, y - r, 2 * r, 2 * r); }
    }
  }
}
