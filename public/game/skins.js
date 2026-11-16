// Livery textures for the car body, drawn pixel by pixel (32x32, nearest filtering).
import * as THREE from 'three';

const cache = new Map();
const css = c => '#' + c.toString(16).padStart(6, '0');

function shade(c, k) {
  const r = Math.min(255, ((c >> 16) & 255) * k) | 0, g = Math.min(255, ((c >> 8) & 255) * k) | 0, b = Math.min(255, (c & 255) * k) | 0;
  return `rgb(${r},${g},${b})`;
}

/** Texture for `skin` painted on top of body colour `color` (number). Returns null for plain paint. */
export function skinTexture(skin, color) {
  if (!skin || skin === 'none') return null;
  const key = skin + ':' + color;
  if (cache.has(key)) return cache.get(key);
  if (HIRES[skin]) {                                          // newer liveries: 128 px, smooth filtering
    const tex = HIRES[skin](color);
    cache.set(key, tex);
    return tex;
  }
  const S = 32, cv = document.createElement('canvas'); cv.width = cv.height = S;
  const g = cv.getContext('2d');
  g.fillStyle = css(color); g.fillRect(0, 0, S, S);
  const px = (x, y, w = 1, h = 1) => g.fillRect(x, y, w, h);
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

  if (skin === 'stripes') {                                   // twin racing stripes
    g.fillStyle = '#f4f4f4'; px(11, 0, 3, S); px(18, 0, 3, S);
    g.fillStyle = '#16161c'; px(14, 0, 1, S); px(17, 0, 1, S);
  } else if (skin === 'flames') {                             // flames licking up from the bottom
    for (let x = 0; x < S; x += 4) {
      const h = 8 + ((x * 7) % 9);
      g.fillStyle = '#ff7a1a'; px(x, S - h, 4, h);
      g.fillStyle = '#ffd21a'; px(x + 1, S - h * 0.6, 2, h * 0.6);
      g.fillStyle = '#ff3b1a'; px(x, S - h, 4, 1);
    }
  } else if (skin === 'checker') {                            // chequered flag band
    for (let y = 10; y < 22; y += 4) for (let x = 0; x < S; x += 4) { g.fillStyle = ((x + y) / 4) % 2 ? '#111' : '#fff'; px(x, y, 4, 4); }
  } else if (skin === 'camo') {                               // dark and light blobs
    for (let i = 0; i < 26; i++) { g.fillStyle = shade(color, i % 2 ? 0.55 : 1.35); px((rnd() * S) | 0, (rnd() * S) | 0, 3 + ((rnd() * 5) | 0), 2 + ((rnd() * 4) | 0)); }
  } else if (skin === 'tiger') {                              // black tiger stripes
    g.fillStyle = '#16100a';
    for (let x = -4; x < S; x += 7) for (let y = 0; y < S; y += 2) px(x + ((y * 3) % 5) + (y >> 2), y, 2, 2);
  } else if (skin === 'stars') {                              // night sky with stars
    g.fillStyle = shade(color, 0.3); g.fillRect(0, 0, S, S);
    g.fillStyle = '#ffffff'; for (let i = 0; i < 22; i++) px((rnd() * S) | 0, (rnd() * S) | 0);
    g.fillStyle = '#ffe14a'; for (let i = 0; i < 6; i++) { const x = (rnd() * 28) | 0, y = (rnd() * 28) | 0; px(x, y + 1, 3, 1); px(x + 1, y, 1, 3); }
  } else if (skin === 'grid') {                               // neon grid on dark paint
    g.fillStyle = shade(color, 0.25); g.fillRect(0, 0, S, S);
    g.fillStyle = '#35e8ff'; for (let i = 0; i < S; i += 8) { px(i, 0, 1, S); px(0, i, S, 1); }
    g.fillStyle = '#ff3bd0'; px(0, 4, S, 1); px(4, 0, 1, S);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter; tex.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, tex);
  return tex;
}

// ---------- high-resolution liveries (vinyls) ----------
function canvas128(color) {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const g = cv.getContext('2d'); g.fillStyle = css(color); g.fillRect(0, 0, 128, 128);
  return [cv, g];
}
function done(cv) {
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
/** Colour with its hue turned by `deg` (for two-tone liveries). */
function hueShift(c, deg) {
  const col = new THREE.Color(c), hsl = {}; col.getHSL(hsl);
  col.setHSL((hsl.h + deg / 360 + 1) % 1, Math.max(0.55, hsl.s), Math.min(0.6, Math.max(0.35, hsl.l)));
  return '#' + col.getHexString();
}

const HIRES = {
  fade(color) {                                               // two-tone gradient with a thin pinstripe
    const [cv, g] = canvas128(color);
    const gr = g.createLinearGradient(0, 0, 128, 128);
    gr.addColorStop(0, shade(color, 1.25)); gr.addColorStop(0.55, css(color)); gr.addColorStop(1, hueShift(color, 50));
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    g.strokeStyle = 'rgba(255,255,255,.8)'; g.lineWidth = 2; g.beginPath(); g.moveTo(0, 92); g.lineTo(128, 60); g.stroke();
    return done(cv);
  },
  carbon(color) {                                             // carbon fibre weave with a paint accent band
    const [cv, g] = canvas128(0x17181c);
    for (let y = 0; y < 128; y += 8) for (let x = 0; x < 128; x += 8) {
      const odd = ((x + y) / 8) % 2;
      const gr = odd ? g.createLinearGradient(x, y, x + 8, y) : g.createLinearGradient(x, y, x, y + 8);
      gr.addColorStop(0, '#121317'); gr.addColorStop(0.5, '#34363e'); gr.addColorStop(1, '#121317');
      g.fillStyle = gr; g.fillRect(x, y, 8, 8);
    }
    g.fillStyle = css(color); g.fillRect(0, 100, 128, 14);
    g.fillStyle = 'rgba(255,255,255,.7)'; g.fillRect(0, 98, 128, 2);
    return done(cv);
  },
  tribal(color) {                                             // sharp black swooshes
    const [cv, g] = canvas128(color);
    g.fillStyle = '#0d0d12';
    const blade = (x, y, s, flip) => {
      g.save(); g.translate(x, y); g.scale(flip ? -s : s, s);
      g.beginPath(); g.moveTo(0, 0); g.bezierCurveTo(30, -10, 60, -40, 70, -70); g.bezierCurveTo(55, -38, 40, -18, 10, 6);
      g.bezierCurveTo(40, 0, 70, 10, 92, 30); g.bezierCurveTo(60, 22, 30, 20, 0, 0); g.fill(); g.restore();
    };
    blade(6, 96, 1.1, false); blade(122, 70, 0.8, true); blade(20, 40, 0.55, false);
    g.strokeStyle = shade(color, 1.5); g.lineWidth = 2; g.beginPath(); g.moveTo(0, 118); g.lineTo(128, 118); g.stroke();
    return done(cv);
  },
  sponsor(color) {                                            // race livery: diagonal band, number roundel, sponsor stickers
    const [cv, g] = canvas128(color);
    g.fillStyle = '#f4f4f6'; g.beginPath(); g.moveTo(0, 70); g.lineTo(128, 30); g.lineTo(128, 58); g.lineTo(0, 98); g.fill();
    g.fillStyle = '#16161c'; g.beginPath(); g.moveTo(0, 98); g.lineTo(128, 58); g.lineTo(128, 64); g.lineTo(0, 104); g.fill();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(64, 64, 22, 0, 7); g.fill();
    g.strokeStyle = '#16161c'; g.lineWidth = 4; g.stroke();
    g.fillStyle = '#16161c'; g.font = 'italic bold 26px Bahnschrift, Arial Narrow, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('77', 64, 66);
    g.fillStyle = '#ffcc1a'; g.fillRect(8, 8, 46, 14); g.fillStyle = '#16161c'; g.font = 'bold 11px Arial, sans-serif'; g.fillText('NITRO', 31, 16);
    g.fillStyle = '#16161c'; g.fillRect(74, 108, 46, 12); g.fillStyle = '#ff5a1a'; g.fillText('OCTANE', 97, 115);
    return done(cv);
  },
  splash(color) {                                             // paint splatters with drips
    const [cv, g] = canvas128(color);
    let seed = 11; const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const cols = ['#ff2d9a', '#35e8ff', '#ffe14a', '#7dff5a', '#ffffff'];
    for (let i = 0; i < 16; i++) {
      const x = r() * 128, y = r() * 110, rad = 4 + r() * 12; g.fillStyle = cols[i % cols.length];
      g.beginPath(); g.arc(x, y, rad, 0, 7); g.fill();
      for (let k = 0; k < 5; k++) { const a = r() * 6.28, d = rad + r() * 9; g.beginPath(); g.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, 1 + r() * 2.5, 0, 7); g.fill(); }
      if (r() < 0.6) g.fillRect(x - 1.5, y, 3, rad + r() * 18);       // drip
    }
    return done(cv);
  },
  kanji(color) {                                              // drift-scene vinyl: big red disc, katakana, speed stripes
    const [cv, g] = canvas128(color);
    g.fillStyle = '#f2f2f4'; g.fillRect(0, 0, 128, 18); g.fillRect(0, 110, 128, 18);
    g.fillStyle = '#d4202a'; g.fillRect(0, 18, 128, 4); g.fillRect(0, 106, 128, 4);
    g.fillStyle = '#d4202a'; g.beginPath(); g.arc(44, 64, 30, 0, 7); g.fill();
    g.fillStyle = '#101014'; g.font = 'bold 22px "Yu Gothic", "Meiryo", "MS Gothic", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('ドリフト', 92, 64);
    g.font = 'italic bold 10px Arial, sans-serif'; g.fillText('TOKYO DRIFT CLUB', 64, 9);
    return done(cv);
  },
};
