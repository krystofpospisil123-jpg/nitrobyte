// Live tuning panel (press T). Sliders edit CONFIG directly, so changes apply instantly.
// "Kopírovat" puts the current values on the clipboard as JSON to paste back into config.js.
import { CONFIG } from './config.js';

const DEFAULTS = JSON.parse(JSON.stringify(CONFIG));
const GROUPS = ['car', 'drift', 'turbo', 'ramp', 'pads', 'rocketStart', 'bots'];

const panel = document.createElement('div');
panel.hidden = true;
panel.style.cssText = 'position:fixed;top:0;right:0;bottom:0;width:300px;overflow:auto;background:rgba(10,10,30,.92);border-left:2px solid #8a8fd0;padding:10px;font-size:12px;z-index:5';
document.body.appendChild(panel);

function build() {
  panel.innerHTML = '<b>LADĚNÍ (T = zavřít)</b> <button id="tcopy">Kopírovat</button> <button id="treset">Reset</button>';
  for (const g of GROUPS) {
    panel.insertAdjacentHTML('beforeend', `<div style="margin-top:10px;color:#ffd23a">${g}</div>`);
    for (const [k, v] of Object.entries(CONFIG[g])) {
      if (typeof v !== 'number') continue;
      const max = Math.max(1, DEFAULTS[g][k] * 3);
      const row = document.createElement('div');
      row.innerHTML = `<div style="display:flex;justify-content:space-between"><span>${k}</span><span>${v}</span></div>
        <input type="range" min="0" max="${max}" step="${max / 200}" value="${v}" style="width:100%">`;
      const [label, input] = [row.querySelector('span:last-child'), row.querySelector('input')];
      input.oninput = () => { CONFIG[g][k] = +(+input.value).toFixed(3); label.textContent = CONFIG[g][k]; };
      panel.appendChild(row);
    }
  }
  panel.querySelector('#tcopy').onclick = () => {
    const out = Object.fromEntries(GROUPS.map(g => [g, CONFIG[g]]));
    navigator.clipboard?.writeText(JSON.stringify(out, null, 2));
  };
  panel.querySelector('#treset').onclick = () => {
    for (const g of GROUPS) Object.assign(CONFIG[g], DEFAULTS[g]);
    build();
  };
}
build();
addEventListener('keydown', e => { if (e.code === 'KeyT') panel.hidden = !panel.hidden; });
