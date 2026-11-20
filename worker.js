// Hublot sur Cloudflare Workers : pages statiques + appairage (Durable Object).
// La vidéo et les fichiers ne passent jamais ici : ils vont en pair à pair (WebRTC).
import { DurableObject } from 'cloudflare:workers';

const TTL = 5 * 60 * 1000;  // validité d'un code
const MAX_FAILS = 8;        // essais ratés par IP et par minute

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const asset = path => env.ASSETS.fetch(new Request(new URL(path, url), request));

    if (url.pathname === '/ws') {
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('WebSocket attendu', { status: 426 });
      return env.HUB.get(env.HUB.idFromName('global')).fetch(request);
    }
    if (url.pathname === '/config') return config(env);
    if (url.pathname === '/') return asset('/index.html');
    if (url.pathname === '/p') return asset('/phone.html');
    return env.ASSETS.fetch(request);
  }
};

// STUN Cloudflare, plus TURN Cloudflare (TURN_KEY_ID + TURN_API_TOKEN) ou TURN générique (TURN_URL, TURN_USER, TURN_PASS)
async function config(env) {
  const iceServers = [{ urls: 'stun:stun.cloudflare.com:3478' }];
  if (env.TURN_KEY_ID && env.TURN_API_TOKEN) {
    try {
      const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.TURN_API_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttl: 86400 })
      });
      if (r.ok) iceServers.push(...[].concat((await r.json()).iceServers));
    } catch {}
  } else if (env.TURN_URL) {
    iceServers.push({ urls: env.TURN_URL.split(','), username: env.TURN_USER, credential: env.TURN_PASS });
  }
  return Response.json({ iceServers }, { headers: { 'Cache-Control': 'no-store' } });
}

export class Hub extends DurableObject {
  rooms = new Map(); // code -> { pc, timer }
  fails = new Map(); // ip -> { n, until }

  async fetch(request) {
    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    const c = { ws: server, ip: request.headers.get('cf-connecting-ip') || '?', role: null, peer: null, code: null };
    server.addEventListener('message', e => this.onMessage(c, e.data));
    server.addEventListener('close', () => this.leave(c));
    server.addEventListener('error', () => this.leave(c));
    return new Response(null, { status: 101, webSocket: client });
  }

  send(c, m) { try { c.ws.send(JSON.stringify(m)); } catch {} }

  locked(ip) {
    const f = this.fails.get(ip);
    if (!f) return false;
    if (Date.now() > f.until) { this.fails.delete(ip); return false; }
    return f.n >= MAX_FAILS;
  }
  fail(ip) {
    const f = this.fails.get(ip) || { n: 0, until: Date.now() + 60000 };
    f.n++; this.fails.set(ip, f);
  }

  newCode() {
    let c;
    do { c = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1e6).padStart(6, '0'); } while (this.rooms.has(c));
    return c;
  }
  release(c) {
    if (!c.code) return;
    const r = this.rooms.get(c.code);
    if (r) clearTimeout(r.timer);
    this.rooms.delete(c.code);
    c.code = null;
  }
  offerCode(c) {
    this.release(c);
    const code = this.newCode();
    const timer = setTimeout(() => this.offerCode(c), TTL); // expiré : nouveau code automatique
    this.rooms.set(code, { pc: c, timer });
    c.code = code;
    this.send(c, { type: 'code', code, expiresAt: Date.now() + TTL });
  }

  onMessage(c, raw) {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.type === 'host' && !c.role) {
      c.role = 'pc'; this.offerCode(c);
    } else if (m.type === 'join' && !c.role) {
      if (this.locked(c.ip)) return this.send(c, { type: 'error', reason: 'locked' });
      const code = String(m.code || '').replace(/\D/g, '');
      const room = this.rooms.get(code);
      if (!room) { this.fail(c.ip); return this.send(c, { type: 'error', reason: 'invalid' }); }
      c.role = 'phone';
      clearTimeout(room.timer);
      this.rooms.delete(code);   // usage unique
      room.pc.code = null;
      room.pc.peer = c; c.peer = room.pc;
      this.send(room.pc, { type: 'paired' });
      this.send(c, { type: 'paired' });
    } else if (m.type === 'signal' && c.peer) {
      this.send(c.peer, { type: 'signal', data: m.data });
    }
  }

  leave(c) {
    if (c.role === 'pc') this.release(c);
    const p = c.peer;
    if (!p) return;
    c.peer = null; p.peer = null;
    this.send(p, { type: 'peer-left' });
    if (p.role === 'pc') this.offerCode(p);
  }
}
