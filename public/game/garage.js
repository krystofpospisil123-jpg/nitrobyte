// Garage: preview and buy cosmetics, and buy performance upgrades. Driven by the Menu (keyboard / mouse / phone).
// The 3D preview car is shown by main.js through the callbacks.
import { CATALOG, UPGRADES, findItem } from './catalog.js';
import { profile, owns, buyOrEquip, buyUpgrade, upgradePrice, upgradeLevel, lookOf } from './profile.js';
import { sfx } from './sfx.js';

const $ = id => document.getElementById(id);
const hex = v => '#' + v.toString(16).padStart(6, '0');

export class Garage {
  /** cb: { preview(look), changed(), back() } */
  constructor(cb) {
    this.cb = cb;
    this.rows = [
      { cat: 'body', label: 'KAROSERIE' }, { cat: 'color', label: 'BARVA' }, { cat: 'skin', label: 'VZOR' }, { cat: 'wing', label: 'KŘÍDLO' },
      { cat: 'rims', label: 'KOLA' }, { cat: 'glow', label: 'PODSVÍCENÍ' }, { cat: 'flame', label: 'OHEŇ' },
      { up: 'motor' }, { up: 'accel' }, { up: 'turbo' },
      { back: true, label: 'ZPĚT' },
    ];
    this.sel = 0;
    this.cursor = {};
    this.msg = '';
    this.msgTimer = 0;
    $('grows').addEventListener('mouseover', e => {
      const row = e.target.closest('.row'); if (!row || +row.dataset.i === this.sel) return;
      this.sel = +row.dataset.i; sfx.hover(); this.render();
    });
    $('grows').addEventListener('click', e => {
      const row = e.target.closest('.row'); if (!row) return;
      this.sel = +row.dataset.i;
      const arrow = e.target.closest('.arrow');
      if (arrow) this.change(+arrow.dataset.dir); else this.ok();
    });
  }

  open() {
    this.sel = 0;
    for (const cat of Object.keys(CATALOG)) this.cursor[cat] = CATALOG[cat].findIndex(i => i.id === profile.equipped[cat]);
    this.render(); this.preview();
  }

  /** Cosmetics currently under the cursors (what the 3D car shows). */
  preview() {
    const ov = {};
    for (const cat of Object.keys(CATALOG)) ov[cat] = CATALOG[cat][this.cursor[cat]].id;
    this.cb.preview(lookOf(ov));
  }

  move(dir) { this.sel = (this.sel + dir + this.rows.length) % this.rows.length; sfx.select(); this.render(); }

  change(dir) {
    const r = this.rows[this.sel];
    if (!r.cat) return;
    const n = CATALOG[r.cat].length;
    this.cursor[r.cat] = (this.cursor[r.cat] + dir + n) % n;
    sfx.select(); this.render(); this.preview();
  }

  ok() {
    const r = this.rows[this.sel];
    if (r.back) return this.cb.back();
    let res;
    if (r.cat) {
      const item = CATALOG[r.cat][this.cursor[r.cat]];
      res = buyOrEquip(r.cat, item.id);
      this.say(res === 'poor' ? 'Nedostatek mincí!' : res === 'bought' ? `Koupeno: ${item.name}` : `Vybráno: ${item.name}`, res === 'poor');
    } else {
      res = buyUpgrade(r.up);
      this.say(res === 'poor' ? 'Nedostatek mincí!' : res === 'max' ? 'Už je na maximu' : `${UPGRADES[r.up].name} vylepšen!`, res === 'poor' || res === 'max');
    }
    if (res === 'bought') sfx.buy(); else if (res === 'poor' || res === 'max') sfx.nope(); else sfx.select();
    this.cb.changed();
    this.render(); this.preview();
    const el = document.querySelector('#grows .row.sel');          // green flash on purchase, red shake when too poor
    if (el) el.classList.add(res === 'bought' ? 'buyflash' : res === 'poor' || res === 'max' ? 'shake' : 'press');
  }

  back() { this.cb.back(); }

  say(text, bad) { this.msg = text; this.msgBad = bad; clearTimeout(this.msgTimer); this.msgTimer = setTimeout(() => { this.msg = ''; this.render(); }, 2200); }

  render() {
    $('wallet').textContent = '● ' + profile.coins;
    $('grows').innerHTML = this.rows.map((r, i) => {
      const sel = i === this.sel ? ' sel' : '';
      if (r.back) return `<div class="row back${sel}" data-i="${i}">‹ ${r.label}</div>`;
      if (r.up) {
        const U = UPGRADES[r.up], lvl = upgradeLevel(r.up), price = upgradePrice(r.up);
        const pips = '■'.repeat(lvl) + '□'.repeat(3 - lvl);
        const badge = price === null ? '<span class="badge on">MAX</span>' : `<span class="badge ${profile.coins >= price ? 'cost' : 'poor'}">● ${price}</span>`;
        return `<div class="row${sel}" data-i="${i}"><span class="label">${U.name}<small>${U.desc}</small></span><span class="val"><span class="txt">${pips}</span>${badge}</span></div>`;
      }
      const item = CATALOG[r.cat][this.cursor[r.cat]];
      const swatch = typeof item.value === 'number' && r.cat !== 'wing' ? `<i class="sw" style="background:${hex(item.value)}"></i>` :
        (item.value === 'rainbow' ? '<i class="sw rainbow"></i>' : '');
      let badge;
      if (profile.equipped[r.cat] === item.id) badge = '<span class="badge on">✔ VYBRÁNO</span>';
      else if (owns(r.cat, item.id)) badge = '<span class="badge own">MÁŠ</span>';
      else badge = `<span class="badge ${profile.coins >= item.price ? 'cost' : 'poor'}">● ${item.price}</span>`;
      return `<div class="row${sel}" data-i="${i}"><span class="label">${r.label}</span><span class="val"><b class="arrow" data-dir="-1">‹</b><span class="txt">${swatch}${item.name}</span><b class="arrow" data-dir="1">›</b>${badge}</span></div>`;
    }).join('');
    $('gmsg').textContent = this.msg; $('gmsg').className = this.msgBad ? 'bad' : '';
  }
}
