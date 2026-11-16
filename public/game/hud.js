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
    g.strokeStyle = 'rgba(2,6,20,.85)'; g.lineWidth = 11; path(); g.stroke();
    g.save(); g.shadowColor = '#2aa8ff'; g.shadowBlur = 8; g.strokeStyle = '#2aa8ff'; g.lineWidth = 6; path(); g.stroke(); g.restore();
    g.strokeStyle = '#d6efff'; g.lineWidth = 2; path(); g.stroke();
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
    // dark glass disc with a thin ring
    const bg = g.createRadialGradient(C, C, 10, C, C, R + 14);
    bg.addColorStop(0, 'rgba(14,20,44,.88)'); bg.addColorStop(1, 'rgba(4,6,18,.92)');
    g.fillStyle = bg; g.beginPath(); g.arc(C, C, R + 12, 0, 7); g.fill();
    g.strokeStyle = 'rgba(160,200,255,.35)'; g.lineWidth = 2; g.beginPath(); g.arc(C, C, R + 12, 0, 7); g.stroke();
    // scale: faint track, red zone at the end
    g.lineCap = 'butt'; g.lineWidth = 8;
    g.strokeStyle = 'rgba(120,150,210,.22)'; g.beginPath(); g.arc(C, C, R - 2, A0, A0 + SWEEP * 0.78); g.stroke();
    g.strokeStyle = 'rgba(255,50,40,.35)'; g.beginPath(); g.arc(C, C, R - 2, A0 + SWEEP * 0.78, A0 + SWEEP); g.stroke();
    // filled arc up to the current speed: blue -> orange -> red, glowing
    const hot = f < 0.6 ? '#2aa8ff' : f < 0.8 ? '#ff9a1a' : '#ff3322';
    g.save(); g.shadowColor = hot; g.shadowBlur = 14; g.strokeStyle = hot; g.lineWidth = 8;
    g.beginPath(); g.arc(C, C, R - 2, A0, A0 + SWEEP * Math.max(0.004, f)); g.stroke(); g.restore();
    // ticks and numbers 0..8
    g.fillStyle = '#e8f2ff'; g.font = 'italic 700 15px "Bahnschrift SemiCondensed", Bahnschrift, "Arial Narrow", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.strokeStyle = 'rgba(220,235,255,.7)'; g.lineWidth = 1.5;
    for (let i = 0; i <= 8; i++) {
      const a = A0 + SWEEP * i / 8, ca = Math.cos(a), sa = Math.sin(a);
      g.fillText(i, C + ca * (R - 24), C + sa * (R - 24));
      g.beginPath(); g.moveTo(C + ca * (R + 5), C + sa * (R + 5)); g.lineTo(C + ca * (R + 10), C + sa * (R + 10)); g.stroke();
    }
    // needle
    const a = A0 + SWEEP * f;
    g.save(); g.shadowColor = '#ff6a00'; g.shadowBlur = 8; g.strokeStyle = '#fff'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(C - Math.cos(a) * 10, C - Math.sin(a) * 10); g.lineTo(C + Math.cos(a) * (R - 12), C + Math.sin(a) * (R - 12)); g.stroke(); g.restore();
    g.strokeStyle = '#ff6a00'; g.lineWidth = 3; g.beginPath(); g.moveTo(C + Math.cos(a) * (R - 32), C + Math.sin(a) * (R - 32)); g.lineTo(C + Math.cos(a) * (R - 12), C + Math.sin(a) * (R - 12)); g.stroke();
    g.fillStyle = '#1a2038'; g.beginPath(); g.arc(C, C, 7, 0, 7); g.fill(); g.strokeStyle = '#ff8a1a'; g.lineWidth = 2; g.stroke();
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
