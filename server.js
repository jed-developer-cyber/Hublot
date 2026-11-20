// Hublot : serveur d'appairage (signalisation uniquement). Vidéo et fichiers passent en pair à pair.
import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import QRCode from 'qrcode';
import { randomInt } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const dir = join(dirname(fileURLToPath(import.meta.url)), 'public');
const PORT = process.env.PORT || 3000;
const TTL = 5 * 60 * 1000;   // validité d'un code
const MAX_FAILS = 8;         // essais ratés par IP et par minute

const app = express();
app.use(express.static(dir));                                   // "/" = écran ordinateur
app.get('/p', (_, res) => res.sendFile(join(dir, 'phone.html'))); // "/p" = téléphone

// STUN public ; ajoutez un TURN via TURN_URL (séparés par des virgules), TURN_USER, TURN_PASS
app.get('/config', (_, res) => {
  const iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
  if (process.env.TURN_URL) {
    iceServers.push({ urls: process.env.TURN_URL.split(','), username: process.env.TURN_USER, credential: process.env.TURN_PASS });
  }
  res.json({ iceServers });
});

app.get('/qr', async (req, res) => {
  const text = String(req.query.t || '').slice(0, 300);
  res.type('image/svg+xml').send(await QRCode.toString(text, { type: 'svg', margin: 1, color: { dark: '#10203A', light: '#FFFFFF' } }));
});

const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });

const rooms = new Map(); // code -> { pc, timer }
const fails = new Map(); // ip -> { n, until }

const send = (ws, m) => ws && ws.readyState === 1 && ws.send(JSON.stringify(m));
const ipOf = req => req.headers['cf-connecting-ip'] || (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;

function locked(ip) {
  const f = fails.get(ip);
  if (!f) return false;
  if (Date.now() > f.until) { fails.delete(ip); return false; }
  return f.n >= MAX_FAILS;
}
function fail(ip) {
  const f = fails.get(ip) || { n: 0, until: Date.now() + 60000 };
  f.n++; fails.set(ip, f);
}

function newCode() {
  let c;
  do { c = String(randomInt(0, 1e6)).padStart(6, '0'); } while (rooms.has(c));
  return c;
}

function release(pc) {
  if (!pc.code) return;
  const r = rooms.get(pc.code);
  if (r) clearTimeout(r.timer);
  rooms.delete(pc.code);
  pc.code = null;
}

function offerCode(pc) {
  release(pc);
  const code = newCode();
  const timer = setTimeout(() => offerCode(pc), TTL); // expiré : nouveau code automatique
  rooms.set(code, { pc, timer });
  pc.code = code;
  send(pc, { type: 'code', code, expiresAt: Date.now() + TTL });
}

function pair(phone, room, code) {
  clearTimeout(room.timer);
  rooms.delete(code);            // usage unique
  room.pc.code = null;
  room.pc.peer = phone;
  phone.peer = room.pc;
  send(room.pc, { type: 'paired' });
  send(phone, { type: 'paired' });
}

function leave(ws) {
  if (ws.role === 'pc') release(ws);
  const p = ws.peer;
  if (!p) return;
  ws.peer = null; p.peer = null;
  send(p, { type: 'peer-left' });
  if (p.role === 'pc') offerCode(p);
}

wss.on('connection', (ws, req) => {
  ws.ip = ipOf(req);
  ws.alive = true;
  ws.on('pong', () => (ws.alive = true));
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.type === 'host' && !ws.role) {
      ws.role = 'pc'; offerCode(ws);
    } else if (m.type === 'join' && !ws.role) {
      if (locked(ws.ip)) return send(ws, { type: 'error', reason: 'locked' });
      const code = String(m.code || '').replace(/\D/g, '');
      const room = rooms.get(code);
      if (!room) { fail(ws.ip); return send(ws, { type: 'error', reason: 'invalid' }); }
      ws.role = 'phone';
      pair(ws, room, code);
    } else if (m.type === 'signal' && ws.peer) {
      send(ws.peer, { type: 'signal', data: m.data });
    }
  });
  ws.on('close', () => leave(ws));
});

// Garde les connexions vivantes à travers les tunnels
setInterval(() => wss.clients.forEach(ws => {
  if (!ws.alive) return ws.terminate();
  ws.alive = false; ws.ping();
}), 25000);

server.listen(PORT, () => console.log(`Hublot : http://localhost:${PORT}`));
