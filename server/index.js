// NITROBYTE server.
// - Serves /game (PC) and /controller (phone) pages
// - Generates a self-signed HTTPS certificate (iPhone needs HTTPS for motion sensors) - or, when HOSTED=1,
//   runs plain HTTP behind a host / tunnel that provides real HTTPS
// - Pairs each phone with ONE game page (4-digit pair code) and relays inputs phone -> game, status game -> phone
// - Online rooms: game pages join a room (4-letter code) and the server just fans their messages out to the others
// NO game logic lives here.

import express from 'express';
import https from 'https';
import http from 'http';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import QRCode from 'qrcode';
import selfsigned from 'selfsigned';
import compression from 'compression';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const HOSTED = !!process.env.HOSTED;                     // HOSTED=1: plain HTTP on PORT (a tunnel / host adds HTTPS)
const HTTPS_PORT = Number(process.env.PORT) || 3000;
const HTTP_PORT = HOSTED ? HTTPS_PORT : HTTPS_PORT + 1;  // plain HTTP, also used for localhost and tunnels
const MAX_PHONES = 4;                                    // phones per game page
const MAX_ROOM = 8;                                      // players per online room
const COLORS = ['#ff4040', '#3a8dff', '#ffd23a', '#3fd36b']; // phone slot colours

// ---- limits for public hosting ----
const MAX_ROOMS = 300;               // rooms alive at the same time
const MAX_WS_PER_IP = 24;            // websocket connections per address (game pages + phones)
const MSG_RATE = 100;                // average messages per second per connection (bursts up to 2x)
const CREATE_COOLDOWN_MS = 3000;     // one game page may create a room every 3 s

// ---------- LAN address ----------
function getLanIp() {
  const candidates = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) {
      if (i.family === 'IPv4' && !i.internal) candidates.push(i.address);
    }
  }
  // Prefer typical home-network ranges over virtual adapters (VirtualBox, WSL, ...)
  return candidates.find(a => a.startsWith('192.168.')) || candidates.find(a => a.startsWith('10.')) || candidates[0] || 'localhost';
}
const LAN_IP = getLanIp();

// ---------- certificate (created once, cached in /certs) ----------
async function loadOrCreateCert() {
  const dir = path.join(ROOT, 'certs');
  const keyFile = path.join(dir, 'key.pem');
  const certFile = path.join(dir, 'cert.pem');
  const ipFile = path.join(dir, 'ip.txt');
  // Regenerate when the LAN IP changed (cert must contain the IP as SAN)
  if (fs.existsSync(keyFile) && fs.existsSync(certFile) && fs.existsSync(ipFile) && fs.readFileSync(ipFile, 'utf8') === LAN_IP) {
    return { key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) };
  }
  fs.mkdirSync(dir, { recursive: true });
  const pems = await selfsigned.generate([{ name: 'commonName', value: 'nitrobyte.local' }], {
    days: 825,
    keySize: 2048,
    algorithm: 'sha256',
    extensions: [{
      name: 'subjectAltName',
      altNames: [
        { type: 2, value: 'localhost' },
        { type: 7, ip: '127.0.0.1' },
        { type: 7, ip: LAN_IP },
      ],
    }],
  });
  fs.writeFileSync(keyFile, pems.private);
  fs.writeFileSync(certFile, pems.cert);
  fs.writeFileSync(ipFile, LAN_IP);
  console.log('Vygenerován nový self-signed certifikát pro', LAN_IP);
  return { key: pems.private, cert: pems.cert };
}

// ---------- express ----------
const app = express();
app.set('trust proxy', true);
app.use(compression());                                                       // three.js is >1 MB: gzip it
app.get('/healthz', (req, res) => res.type('text').send('ok'));              // for the host's health check
app.use('/vendor/three', express.static(path.join(ROOT, 'node_modules', 'three'), { maxAge: '7d' }));
// no-cache = the browser must revalidate (cheap 304) so players never run an old cached game / controller
const fresh = { setHeaders: res => res.setHeader('Cache-Control', 'no-cache') };
app.use('/game', express.static(path.join(ROOT, 'public', 'game'), fresh));
app.use('/controller', express.static(path.join(ROOT, 'public', 'controller'), fresh));
app.get('/', (req, res) => res.redirect('/game/'));

/** Address phones should use: the LAN address when the PC page is opened on localhost, otherwise the address it was opened on (tunnel / host). */
function publicBase(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host || '';
  const proto = String(req.headers['x-forwarded-proto'] || (req.socket.encrypted ? 'https' : 'http')).split(',')[0].trim();
  if (/^(localhost|127\.|\[::1\])/.test(host) && !HOSTED) return `https://${LAN_IP}:${HTTPS_PORT}`;
  return `${proto}://${host}`;
}

const qrCache = new Map();
// Info for the game page: controller URL (with the pair code) + QR code (as data URL)
app.get('/api/info', async (req, res) => {
  const pair = String(req.query.pair || '').replace(/\D/g, '').slice(0, 4);
  const base = publicBase(req);
  const url = `${base}/controller/${pair ? '?pair=' + pair : ''}`;
  let qr = qrCache.get(url);
  if (!qr) { qr = await QRCode.toDataURL(url, { margin: 1, width: 360 }); if (qrCache.size > 500) qrCache.clear(); qrCache.set(url, qr); }
  res.json({ url, qr, base, maxPlayers: MAX_PHONES, colors: COLORS });
});

// ---------- game pages (PCs) ----------
// Each connected game page gets an id and a 4-digit pair code. Its phones pair with that code.
const wss = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024 });
const games = new Map();            // id -> { id, ws, pair, phones: [..4], room, name }
const byPair = new Map();           // pair code -> game
const tokens = new Map();           // http phone token -> { game, slot }
let nextGameId = 1;

const send = (ws, msg) => { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); };
const toGame = (game, msg) => send(game.ws, msg);

function newPair() {
  for (let i = 0; i < 50; i++) {
    const p = String(1000 + Math.floor(Math.random() * 9000));
    if (!byPair.has(p)) return p;
  }
  return String(Date.now()).slice(-4);
}

// ---------- phones ----------
// A phone connects over WebSocket, or - if its browser refuses WebSocket with a self-signed
// certificate (common on iPhone Safari) - over plain HTTPS requests. Both end up in game.phones.
// Phone entry: { kind: 'ws' | 'http', send(msg), token?, lastSeen? }

/** Find the game page a phone belongs to: by pair code, or (LAN, no code) the only game page. */
function findGame(pair) {
  if (pair && byPair.has(pair)) return byPair.get(pair);
  if (!pair && games.size === 1) return [...games.values()][0];
  return null;
}

function claimSlot(game, client) {
  const slot = game.phones.findIndex(s => s === null);
  if (slot === -1) return -1;
  game.phones[slot] = client;
  toGame(game, { t: 'join', slot, color: COLORS[slot] });
  console.log(`Telefon připojen ke hře ${game.pair} jako hráč ${slot + 1} (${client.kind})`);
  return slot;
}
function releaseSlot(game, slot, client) {
  if (game.phones[slot] !== client) return;
  game.phones[slot] = null;
  if (client.token) tokens.delete(client.token);
  toGame(game, { t: 'leave', slot });
}
function relayInput(game, slot, m) {
  // Forward only whitelisted input fields, no logic here
  toGame(game, { t: 'input', slot, steer: m.steer, throttle: m.throttle, brake: m.brake, drift: m.drift, turbo: m.turbo });
}

// ---------- online rooms ----------
const rooms = new Map();            // code -> { code, host, members: [gameId...] }
const ROOM_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

function newRoomCode() {
  for (let i = 0; i < 50; i++) {
    let c = ''; for (let k = 0; k < 4; k++) c += ROOM_LETTERS[Math.floor(Math.random() * ROOM_LETTERS.length)];
    if (!rooms.has(c)) return c;
  }
  return String(Date.now()).slice(-4);
}
/** Names are shown in HTML on other players' screens: keep letters, digits, space and a few symbols only. */
const cleanName = n => String(n || '').replace(/[^\p{L}\p{N} _.\-]/gu, '').trim().slice(0, 16) || 'Hráč';
/** The garage look is relayed to everybody: keep only plain numbers / short strings in the expected fields. */
function cleanLook(l) {
  if (!l || typeof l !== 'object') return null;
  const num = v => (Number.isFinite(v) ? Math.max(0, Math.min(0xffffff, v | 0)) : 0);
  const str = v => String(v).replace(/[^a-z]/g, '').slice(0, 12);
  return { color: num(l.color), skin: str(l.skin || 'none'), wing: Math.max(0, Math.min(3, l.wing | 0)), rims: num(l.rims),
    glow: l.glow === 'rainbow' ? 'rainbow' : (l.glow == null ? null : num(l.glow)), flame: num(l.flame) };
}
const peerOf = g => ({ id: g.id, name: g.name, look: g.look });
const roomMembers = room => room.members.map(id => games.get(id)).filter(Boolean);
const toRoom = (room, msg, exceptId = null) => roomMembers(room).forEach(g => { if (g.id !== exceptId) toGame(g, msg); });

function leaveRoom(game) {
  const room = game.room && rooms.get(game.room);
  game.room = null;
  if (!room) return;
  room.members = room.members.filter(id => id !== game.id);
  if (!room.members.length) { rooms.delete(room.code); return; }
  if (room.host === game.id) { room.host = room.members[0]; toRoom(room, { t: 'host', id: room.host }); }
  toRoom(room, { t: 'peer-', id: game.id });
}

function joinRoom(game, room) {
  room.members.push(game.id); game.room = room.code;
  toGame(game, { t: 'room', code: room.code, you: game.id, host: room.host, peers: roomMembers(room).map(peerOf) });
  toRoom(room, { t: 'peer+', peer: peerOf(game) }, game.id);
}

function onGameMessage(game, m) {
  switch (m.t) {
    case 'to':                                           // game -> phone (status, vibration)
      if (game.phones[m.slot]) game.phones[m.slot].send(m.data);
      break;
    case 'room.create': {
      if (Date.now() - game.lastCreate < CREATE_COOLDOWN_MS) return toGame(game, { t: 'room.error', msg: 'Počkej chvíli a zkus to znovu' });
      if (rooms.size >= MAX_ROOMS) return toGame(game, { t: 'room.error', msg: 'Server je teď plný, zkus to později' });
      leaveRoom(game);
      game.lastCreate = Date.now();
      game.name = cleanName(m.name); game.look = cleanLook(m.look);
      const room = { code: newRoomCode(), host: game.id, members: [] };
      rooms.set(room.code, room); joinRoom(game, room);
      console.log(`Místnost ${room.code} vytvořena`);
      break;
    }
    case 'room.join': {
      leaveRoom(game);
      const room = rooms.get(String(m.code || '').toUpperCase().trim());
      if (!room) return toGame(game, { t: 'room.error', msg: 'Místnost s tímto kódem neexistuje' });
      if (room.members.length >= MAX_ROOM) return toGame(game, { t: 'room.error', msg: 'Místnost je plná' });
      game.name = cleanName(m.name); game.look = cleanLook(m.look);
      joinRoom(game, room);
      break;
    }
    case 'room.update': {                                // new name / garage look
      game.name = cleanName(m.name || game.name); game.look = cleanLook(m.look) || game.look;
      const room = game.room && rooms.get(game.room);
      if (room) toRoom(room, { t: 'peer~', peer: peerOf(game) }, game.id);
      break;
    }
    case 'room.send': {                                  // fan out to everybody else in the room (or one target)
      const room = game.room && rooms.get(game.room); if (!room) return;
      if (!m.data || typeof m.data !== 'object' || typeof m.data.k !== 'string' || m.data.k.length > 8) return;      // only {k: 'st' | 'start' | ...}
      const msg = { t: 'rm', from: game.id, data: m.data };
      if (m.to) { const g = games.get(m.to); if (g && g.room === game.room) toGame(g, msg); }
      else toRoom(room, msg, game.id);
      break;
    }
    case 'room.leave': leaveRoom(game); break;
  }
}

// ---------- websocket ----------
const ipCount = new Map();
const clientIp = req => String(req.headers['fly-client-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();

/** Token bucket per connection: drops messages from a client that floods the server. */
function allow(ws) {
  const now = Date.now();
  ws.tokens = Math.min(MSG_RATE * 2, (ws.tokens ?? MSG_RATE * 2) + ((now - (ws.lastMsg || now)) / 1000) * MSG_RATE);
  ws.lastMsg = now;
  if (ws.tokens < 1) return false;
  ws.tokens--; return true;
}

wss.on('connection', (ws, req) => {
  const ip = clientIp(req);
  if ((ipCount.get(ip) || 0) >= MAX_WS_PER_IP) { ws.close(); return; }
  ipCount.set(ip, (ipCount.get(ip) || 0) + 1);
  ws.on('close', () => { const n = (ipCount.get(ip) || 1) - 1; if (n <= 0) ipCount.delete(ip); else ipCount.set(ip, n); });
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('error', () => {});
  const q = new URL(req.url, 'http://x').searchParams;
  const role = q.get('role');

  if (role === 'game') {
    const game = { id: nextGameId++, ws, pair: newPair(), phones: new Array(MAX_PHONES).fill(null), room: null, name: 'Hráč', look: null, lastCreate: 0 };
    games.set(game.id, game); byPair.set(game.pair, game);
    send(ws, { t: 'hello', id: game.id, pair: game.pair });
    ws.on('message', raw => { if (!allow(ws)) return; let m; try { m = JSON.parse(raw); } catch { return; } if (m && typeof m === 'object') onGameMessage(game, m); });
    ws.on('close', () => {
      leaveRoom(game);
      games.delete(game.id); byPair.delete(game.pair);
      game.phones.forEach(p => p && p.close && p.close());
    });
    return;
  }

  // ----- phone controller over WebSocket -----
  const game = findGame((q.get('pair') || '').replace(/\D/g, ''));
  if (!game) { send(ws, { t: 'badpair' }); ws.close(); return; }
  const client = { kind: 'ws', send: msg => send(ws, msg), close: () => ws.close() };
  const slot = claimSlot(game, client);
  if (slot === -1) { send(ws, { t: 'full' }); ws.close(); return; }
  send(ws, { t: 'welcome', slot, color: COLORS[slot] });
  ws.on('message', raw => {
    if (!allow(ws)) return;
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m && m.t === 'input') relayInput(game, slot, m);
  });
  ws.on('close', () => releaseSlot(game, slot, client));
});

// ---------- HTTPS fallback for phones ----------
app.post('/api/join', express.json({ limit: '1kb' }), (req, res) => {
  const game = findGame(String((req.body || {}).pair || '').replace(/\D/g, ''));
  if (!game) return res.json({ bad: true });
  // HTTP phones cannot receive pushes, so messages from the game wait in a queue and ride back on the next /api/input reply
  const client = { kind: 'http', token: crypto.randomUUID(), lastSeen: Date.now(), queue: [], send(msg) { this.queue.push(msg); if (this.queue.length > 30) this.queue.shift(); } };
  const slot = claimSlot(game, client);
  if (slot === -1) return res.json({ full: true });
  tokens.set(client.token, { game, slot });
  res.json({ slot, color: COLORS[slot], token: client.token });
});
app.post('/api/input', express.json({ limit: '1kb' }), (req, res) => {
  const m = req.body || {};
  const ref = tokens.get(m.token);
  if (!ref || ref.game.phones[ref.slot] === null) return res.status(410).end();      // unknown token -> phone must join again
  const client = ref.game.phones[ref.slot];
  client.lastSeen = Date.now();
  relayInput(ref.game, ref.slot, m);
  res.json({ msgs: client.queue.splice(0) });
});
// HTTP phones have no "close" event: drop them after a few seconds of silence
setInterval(() => {
  for (const game of games.values()) game.phones.forEach((c, slot) => { if (c && c.kind === 'http' && Date.now() - c.lastSeen > 4000) releaseSlot(game, slot, c); });
}, 1000);

// Heartbeat: ping every 25 s, drop connections that did not answer (dead phones / closed laptops stay out of the rooms)
setInterval(() => {
  wss.clients.forEach(ws => { if (!ws.isAlive) return ws.terminate(); ws.isAlive = false; try { ws.ping(); } catch {} });
}, 25000);

function attachUpgrade(server) {
  server.on('upgrade', (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
  });
}

// ---------- start ----------
const httpServer = http.createServer(app);
attachUpgrade(httpServer);
if (HOSTED) {
  httpServer.listen(HTTP_PORT, '0.0.0.0', () => {
    console.log(`\n=== NITROBYTE běží (HOSTED, HTTP na portu ${HTTP_PORT}) ===`);
  });
} else {
  const creds = await loadOrCreateCert();
  const httpsServer = https.createServer(creds, app);
  attachUpgrade(httpsServer);
  httpsServer.listen(HTTPS_PORT, '0.0.0.0');
  httpServer.listen(HTTP_PORT, '0.0.0.0', () => {
    console.log('\n=== NITROBYTE běží ===');
    console.log(`Hra na PC:      http://localhost:${HTTP_PORT}/game/`);
    console.log(`Ovladač (HTTPS): https://${LAN_IP}:${HTTPS_PORT}/controller/   (QR kód je na stránce hry)`);
    console.log(`Online hra: spusť tunel na http://localhost:${HTTP_PORT} (viz README) a pošli kamarádům jeho adresu + /game/\n`);
  });
}
