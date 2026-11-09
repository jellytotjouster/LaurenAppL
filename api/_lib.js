/* Shared code for the three small back-end functions: high scores, "tell me" sign-ups, and the owner page.
   Everything is kept in two small JSON files inside a PRIVATE Vercel Blob store (nobody can open them from the web; only these functions can).
   Files start with an underscore so Vercel does not publish this one as an address of its own. */
import crypto from 'node:crypto';

/* ---------- storage ---------- */
let realStore = null;
export function blobStore() {
  if (globalThis.__applTestStore) return globalThis.__applTestStore;       // only ever set by the local tests
  if (realStore) return realStore;                                         // one connection per warm server, so what it remembers is shared by every request
  let lib = null;
  const load = async () => lib || (lib = await import('@vercel/blob'));
  return (realStore = {
    async read(path) {
      const { get } = await load();
      const r = await get(path, { access: 'private', useCache: false });
      if (!r || r.statusCode !== 200 || !r.stream) return { data: null, etag: null };
      return { data: JSON.parse(await new Response(r.stream).text()), etag: r.blob.etag };
    },
    async write(path, data, etag) {
      const { put } = await load();
      await put(path, JSON.stringify(data), {
        access: 'private', contentType: 'application/json', allowOverwrite: !!etag, ...(etag ? { ifMatch: etag } : {})
      });
    },
    isConflict(e) { return !!e && (e.name === 'BlobPreconditionFailedError' || /precondition|already exists|etag/i.test(String(e.message || ''))); }
  });
}

/* read, change, write back; if somebody else wrote in between, read again and retry (so two people saving at once never lose each other's entry) */
export async function update(store, path, fn, tries = 8) {
  for (let i = 0; ; i++) {
    const { data, etag } = await store.read(path);
    const r = fn(data);
    if (!r || r.next === undefined) return r ? r.out : undefined;
    try { await store.write(path, r.next, etag); return r.out; }
    catch (e) {
      if (!store.isConflict(e) || i >= tries - 1) throw e;
      await new Promise(ok => setTimeout(ok, 30 + Math.random() * 120));
    }
  }
}

/* ---------- small helpers ---------- */
export const json = (status, body) => ({ status, type: 'application/json; charset=utf-8', body: JSON.stringify(body) });
export const NAME_MAX = 12, SCORE_MAX = 100000, KEEP_SCORES = 200, TOP_SCORES = 50, MAX_SUBS = 5000;
export const cleanName = s => String(s == null ? '' : s).replace(/[^\p{L}\p{M}\p{N} _.\-]/gu, '').replace(/\s+/g, ' ').slice(0, NAME_MAX).trim();
const SECRET_RE = /^[A-Za-z0-9_-]{20,64}$/;
export const pidOf = secret => crypto.createHash('sha256').update('appl-player:' + secret).digest('hex').slice(0, 20);   // the public id of a player; the secret never leaves their browser except to prove it is theirs
const byRank = (a, b) => b.score - a.score || a.at - b.at || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
const validRow = r => r && typeof r.id === 'string' && typeof r.name === 'string' && Number.isInteger(r.score) && r.score > 0 && Number.isFinite(r.at);
const pub = r => ({ id: r.id, name: r.name, score: r.score, at: r.at });
const nameKey = s => String(s == null ? '' : s).toLowerCase().replace(/\s+/g, ' ').trim();       // "LAH", "lah" and " Lah " are one name

/* One person can play on several phones or browsers, and behind the scenes each of those is its own player. The public board shows every name once, with its best score from any of them,
   so nobody sees "LAH" three times while his lower scores quietly go missing. The row is marked as the viewer's own (id = me) when any of the viewer's phones is in it. */
function oneRowPerName(all, me) {                                   // all: best first
  const by = new Map(), out = [];
  for (const r of all) {
    const k = nameKey(r.name), g = by.get(k);
    if (g) { if (me && r.id === me) g.id = me; continue; }
    const row = pub(r); by.set(k, row); out.push(row);
  }
  return out;
}

/* ---------- proof that a game was played ---------- */
/* A score is only accepted for a game the server saw begin. When a game starts, the page asks for a "run": a small signed note saying who started a game and when.
   Saving a score hands that note back. The server checks the signature, that it is this player's own, that it has not been used before, and that the score is possible in the time that has passed
   (a flawless player catches about 2.4 drops a second; the limit below is a good margin above that). It needs no storage, so it costs nothing. */
const RUN_MAX_AGE = 6 * 3600e3;
const runKey = () => { const k = process.env.ADMIN_KEY; return typeof k === 'string' && k.length >= 16 ? crypto.createHash('sha256').update('appl-run:' + k).digest() : null; };
export function makeRun(pid, now = Date.now()) {
  const key = runKey(); if (!key) return null;
  const body = Buffer.from(JSON.stringify({ p: pid, t: now, n: crypto.randomBytes(6).toString('hex') })).toString('base64url');
  return body + '.' + crypto.createHmac('sha256', key).update(body).digest('base64url');
}
export function readRun(token, pid, now = Date.now()) {
  const key = runKey();
  if (!key || typeof token !== 'string' || token.length > 400) return null;
  const i = token.indexOf('.'); if (i < 1) return null;
  const body = token.slice(0, i), sig = Buffer.from(token.slice(i + 1), 'base64url'), want = crypto.createHmac('sha256', key).update(body).digest();
  if (sig.length !== want.length || !crypto.timingSafeEqual(sig, want)) return null;
  let r; try { r = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch (e) { return null; }
  if (!r || r.p !== pid || !Number.isFinite(r.t) || r.t > now + 10000 || now - r.t > RUN_MAX_AGE) return null;
  return { t: r.t };
}
/* How many drops could be caught in this many seconds of play. The game starts dropping after half a second, then drops faster and faster until 45 catches.
   jitter: 1 is the average timing; below 1 is luckier than anyone gets. fall: how long a drop takes to reach the mouth. */
export function perfectCatches(secs, jitter = 1, fall = 1) {
  let n = 0, t = 0.5;
  while (t <= secs - fall && n < 20000) { n++; t += (0.95 - 0.55 * Math.min(1, n / 45)) * jitter; }
  return n;
}
const capCatches = secs => Math.ceil(perfectCatches(secs + 2, 0.9, 0.5) * 1.05) + 3;
const flawless = secs => perfectCatches(secs, 1, 2);                     // about what a (near) flawless player reaches: 108 after 60 seconds, 257 after two minutes
export const looksOff = (score, secs) => score >= 150 || (secs >= 90 && score >= 0.85 * flawless(secs));
const starts = new Map();
function startsTooMany(ip, now) {
  if (!ip) return false;
  const a = (starts.get(ip) || []).filter(t => now - t < 3600e3);
  if (a.length >= 300) { starts.set(ip, a); return true; }
  a.push(now); starts.set(ip, a);
  if (starts.size > 2000) starts.clear();
  return false;
}

/* ---------- high scores ---------- */
/* The free storage plan allows 10,000 reads a month, so the board is remembered for a few seconds on each warm server: any number of people watching it (each open board asks every 20 seconds)
   costs at most one read every few seconds. A player's own save asks for a fresh read, and every save or removal makes the server forget what it remembered. */
const BOARD_TTL = 8000;
const board = { store: null, at: 0, rows: null, pending: null };
const forgetBoard = () => { board.rows = null; board.at = 0; board.pending = null; };
async function readBoard(store, fresh, now) {
  if (board.store !== store) { board.store = store; forgetBoard(); }
  if (!fresh) {
    if (board.rows && now - board.at < BOARD_TTL) return board.rows;
    if (board.pending) return board.pending;                     // somebody else is already reading it: share that read
  }
  const p = (async () => {
    const { data } = await store.read('data/scores.json');
    return (data && Array.isArray(data.rows) ? data.rows : []).filter(validRow).sort(byRank);
  })();
  board.pending = p;
  try { const rows = await p; if (board.pending === p) { board.rows = rows; board.at = now; } return rows; }
  finally { if (board.pending === p) board.pending = null; }
}

export async function scoresGet(store, me, fresh = false, now = Date.now()) {
  const all = await readBoard(store, fresh, now);
  const myId = typeof me === 'string' && /^[0-9a-f]{20}$/.test(me) ? me : null;
  const own = myId ? all.find(r => r.id === myId) : null;                                                   // this phone's own best
  const merged = oneRowPerName(all, myId);
  const hit = own ? merged.find(r => r.id === myId) : null;                                                 // the viewer's name on the board, even when below the top 50
  return json(200, { rows: merged.slice(0, TOP_SCORES), mine: hit ? { ...hit, own: own.score } : null });
}

export async function scoresPost(store, body, now = Date.now(), ip = '') {
  if (!body || typeof body !== 'object') return json(400, { error: 'bad' });
  if (typeof body.secret !== 'string' || !SECRET_RE.test(body.secret)) return json(400, { error: 'bad' });
  const id = pidOf(body.secret);
  if (body.action === 'start') {                                                              // a game is starting: hand out the proof
    if (!runKey()) return json(503, { error: 'not set up' });
    if (startsTooMany(ip, now)) return json(429, { error: 'slow' });
    return json(200, { ok: true, run: makeRun(id, now) });
  }
  const name = cleanName(body.name);
  if (!name) return json(400, { error: 'name' });
  const hasScore = body.score !== undefined && body.score !== null;
  const score = hasScore ? body.score : null;
  if (hasScore && (!Number.isInteger(score) || score < 1 || score > SCORE_MAX)) return json(400, { error: 'score' });
  let runT = 0, runSecs = 0;
  if (hasScore) {                                                                              // a score must come with the proof of a game that really started, and be possible in that time
    const r = readRun(body.run, id, now);
    if (!r) return json(422, { error: 'run' });
    runSecs = Math.max(0, (now - r.t) / 1000); runT = r.t;
    if (score > capCatches(runSecs)) return json(422, { error: 'fast' });
  }
  const out = await update(store, 'data/scores.json', data => {
    const rows = (data && Array.isArray(data.rows) ? data.rows : []).filter(validRow);
    const hit = rows.find(r => r.id === id);
    if (hit && hit.touched && now - hit.touched < 1200) return { out: { rate: true } };       // one save at a time per player
    if (!hasScore && !hit) return { out: { missing: true } };
    if (hasScore && hit && runT <= (hit.run || 0)) return { out: { used: true } };            // that game has already been saved
    let kind;
    if (!hit) { rows.push({ id, name, score, at: now, touched: now, run: runT, secs: Math.round(runSecs) }); kind = 'shared'; }
    else if (hasScore && score > hit.score) { hit.name = name; hit.score = score; hit.at = now; hit.touched = now; hit.run = runT; hit.secs = Math.round(runSecs); kind = 'shared'; }
    else { hit.name = name; hit.touched = now; if (hasScore) hit.run = runT; kind = 'kept'; }
    rows.sort(byRank);
    return { next: { rows: rows.slice(0, KEEP_SCORES) }, out: { kind, best: (rows.find(r => r.id === id) || {}).score || 0 } };
  });
  if (out.rate) return json(429, { error: 'slow' });
  if (out.missing) return json(404, { error: 'none' });
  if (out.used) return json(422, { error: 'used' });
  forgetBoard();
  return json(200, { ok: true, kind: out.kind, best: out.best, id });
}

/* ---------- "tell me" sign-ups ---------- */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const TOPIC_RE = /^(animations|originals|frames|work-\d{1,3})$/;
const seen = new Map();                                       // best-effort brake per visitor address (it resets when the function restarts; the real limit is the 5,000 cap)
function tooMany(ip, now) {
  if (!ip) return false;
  const a = (seen.get(ip) || []).filter(t => now - t < 3600e3);
  if (a.length >= 12) { seen.set(ip, a); return true; }
  a.push(now); seen.set(ip, a);
  if (seen.size > 2000) seen.clear();
  return false;
}
export async function notifyPost(store, body, ip, now = Date.now()) {
  if (!body || typeof body !== 'object') return json(400, { error: 'bad' });
  const email = String(body.email == null ? '' : body.email).trim();
  if (!EMAIL_RE.test(email) || email.length > 120) return json(400, { error: 'email' });
  const raw = Array.isArray(body.topics) ? body.topics : body.topics && typeof body.topics === 'object' ? Object.keys(body.topics) : body.topic ? [body.topic] : [];
  const topics = Array.from(new Set(raw.map(String))).filter(t => TOPIC_RE.test(t)).slice(0, 6);
  if (!topics.length) return json(400, { error: 'topic' });
  if (tooMany(ip, now)) return json(429, { error: 'slow' });
  const key = email.toLowerCase();
  const out = await update(store, 'data/notify.json', data => {
    const subs = data && data.subs && typeof data.subs === 'object' ? data.subs : {};
    if (!subs[key] && Object.keys(subs).length >= MAX_SUBS) return { out: { full: true } };
    const cur = subs[key] || { email, topics: {}, at: now };
    topics.forEach(t => { cur.topics[t] = now; });
    cur.email = email;
    subs[key] = cur;
    return { next: { subs }, out: { ok: true } };
  });
  if (out.full) return json(503, { error: 'full' });
  return json(200, { ok: true });
}

/* ---------- crash reports: a short, anonymous note a phone sends when the page died on it (or ran far too slowly) ---------- */
const REPORT_KEEP = 60;
let rall = [];                                                 // when this server took its latest notes: at most 30 an hour in all, to protect the free storage allowance
const rseen = new Map();                                       // best-effort brake per visitor address (it resets when the function restarts; the real limit is keeping only the latest 60)
const rlimited = (ip, now) => {
  if (!ip) return false;
  const a = (rseen.get(ip) || []).filter(x => now - x < 3600e3);
  if (a.length >= 8) { rseen.set(ip, a); return true; }
  a.push(now); rseen.set(ip, a);
  if (rseen.size > 2000) rseen.clear();
  return false;
};
const oneLine = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const whole = (v, max) => { const x = Math.round(+v); return Number.isFinite(x) ? Math.max(0, Math.min(max, x)) : 0; };
export async function reportPost(store, body, ip, now = Date.now()) {
  if (!body || typeof body !== 'object') return json(400, { error: 'bad' });
  if (rlimited(ip, now)) return json(429, { error: 'slow' });
  rall = rall.filter(x => now - x < 3600e3);
  if (rall.length >= 30) return json(429, { error: 'slow' });
  rall.push(now);
  const rec = {
    at: now,
    tag: body.tag === 'slow' ? 'slow' : 'crash',
    mode: whole(body.mode, 3), deadMode: whole(body.deadMode, 3),
    ua: oneLine(body.ua, 160),
    w: whole(body.w, 20000), h: whole(body.h, 20000), dpr: Math.round(Math.min(10, Math.max(0, +body.dpr || 0)) * 10) / 10,
    mem: whole(body.mem, 256), cores: whole(body.cores, 256),
    alive: whole(body.alive, 7200000), fps: whole(body.fps, 1000),
    ev: (Array.isArray(body.ev) ? body.ev : []).slice(-18).map(e => Array.isArray(e) ? [whole(e[0], 7200000), oneLine(e[1], 90)] : null).filter(Boolean)
  };
  await update(store, 'data/reports.json', data => {
    const list = data && Array.isArray(data.list) ? data.list : [];
    list.unshift(rec);
    return { next: { list: list.slice(0, REPORT_KEEP) }, out: 1 };
  });
  return json(200, { ok: true });
}

/* ---------- the owner page ---------- */
const same = (a, b) => crypto.timingSafeEqual(crypto.createHash('sha256').update(String(a)).digest(), crypto.createHash('sha256').update(String(b)).digest());
export const adminOk = (given, expected) => typeof expected === 'string' && expected.length >= 16 && typeof given === 'string' && given.length > 0 && same(given, expected);

export async function adminPost(store, body) {
  const act = body && body.action;
  if (act === 'ping') return json(200, { ok: true });
  if (act === 'list') {
    const [s, n, rp] = await Promise.all([store.read('data/scores.json'), store.read('data/notify.json'), store.read('data/reports.json')]);
    const subs = Object.values(n.data && n.data.subs || {}).filter(x => x && typeof x.email === 'string').map(x => ({ email: x.email, topics: x.topics || {}, at: x.at || 0 }));
    const scores = (s.data && Array.isArray(s.data.rows) ? s.data.rows : []).filter(validRow).sort(byRank).map(r => { const secs = Number.isFinite(r.secs) ? r.secs : 0; return { ...pub(r), secs, by: r.by === 'owner' ? 'owner' : '', flawless: secs ? flawless(secs) : 0, look: !!(secs || r.score >= 150) && looksOff(r.score, secs) }; });
    const reports = (rp.data && Array.isArray(rp.data.list) ? rp.data.list : []).filter(r => r && Number.isFinite(r.at) && Array.isArray(r.ev));
    return json(200, { subs, scores, reports });
  }
  if (act === 'removeSub' && typeof body.email === 'string') {
    await update(store, 'data/notify.json', d => { const subs = d && d.subs || {}; const k = body.email.trim().toLowerCase(); if (!subs[k]) return null; delete subs[k]; return { next: { subs }, out: 1 }; });
    return json(200, { ok: true });
  }
  if (act === 'removeTopic' && typeof body.email === 'string' && typeof body.topic === 'string') {
    await update(store, 'data/notify.json', d => {
      const subs = d && d.subs || {}; const k = body.email.trim().toLowerCase(), cur = subs[k];
      if (!cur || !cur.topics || !(body.topic in cur.topics)) return null;
      delete cur.topics[body.topic]; if (!Object.keys(cur.topics).length) delete subs[k];
      return { next: { subs }, out: 1 };
    });
    return json(200, { ok: true });
  }
  if (act === 'addScore') {                                                                    // the owner adds a score she has checked herself (for example to restore one that never reached the board)
    const name = cleanName(body.name), score = body.score;
    if (!name || !Number.isInteger(score) || score < 1 || score > SCORE_MAX) return json(400, { error: 'bad' });
    const now = Date.now(), id = pidOf('owner-added-' + crypto.randomBytes(12).toString('hex'));
    await update(store, 'data/scores.json', d => {
      const rows = (d && Array.isArray(d.rows) ? d.rows : []).filter(validRow);
      rows.push({ id, name, score, at: now, touched: 0, run: 0, secs: 0, by: 'owner' }); rows.sort(byRank);
      return { next: { rows: rows.slice(0, KEEP_SCORES) }, out: 1 };
    });
    forgetBoard();
    return json(200, { ok: true });
  }
  if (act === 'removeScore' && typeof body.id === 'string') {
    await update(store, 'data/scores.json', d => {
      const rows = (d && Array.isArray(d.rows) ? d.rows : []).filter(validRow), n = rows.filter(r => r.id !== body.id);
      return n.length === rows.length ? null : { next: { rows: n }, out: 1 };
    });
    forgetBoard();
    return json(200, { ok: true });
  }
  if (act === 'clearReports') {
    await update(store, 'data/reports.json', d => (d && Array.isArray(d.list) && d.list.length) ? { next: { list: [] }, out: 1 } : null);
    return json(200, { ok: true });
  }
  return json(400, { error: 'bad' });
}

/* ---------- plumbing between Vercel's request/response and the functions above ---------- */
export async function readBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  let text = '';
  if (typeof req.body === 'string') text = req.body;
  else if (Buffer.isBuffer(req.body)) text = req.body.toString('utf8');
  else {
    const chunks = []; let n = 0;
    for await (const c of req) { n += c.length; if (n > 8192) throw Object.assign(new Error('too big'), { status: 413 }); chunks.push(c); }
    text = Buffer.concat(chunks).toString('utf8');
  }
  if (text.length > 8192) throw Object.assign(new Error('too big'), { status: 413 });
  try { return JSON.parse(text || '{}'); } catch (e) { throw Object.assign(new Error('bad json'), { status: 400 }); }
}
export const clientIp = req => String(req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || '').split(',')[0].trim();
export function sameSite(req) {                                // a browser tab on another website cannot post here
  const o = req.headers.origin; if (!o) return true;
  try { return new URL(o).host === req.headers.host; } catch (e) { return false; }
}
export function reply(res, out) {
  res.statusCode = out.status;
  res.setHeader('Content-Type', out.type || 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (out.headers) Object.keys(out.headers).forEach(k => res.setHeader(k, out.headers[k]));
  res.end(out.body);
}
export async function guarded(req, res, run) {
  try {
    if (req.method === 'POST') {
      if (!sameSite(req)) return reply(res, json(403, { error: 'origin' }));
      if (!/application\/json/i.test(String(req.headers['content-type'] || ''))) return reply(res, json(415, { error: 'type' }));
    }
    return reply(res, await run());
  } catch (e) {
    const status = e && e.status || 500;
    if (status === 500) {
      const name = String(e && e.name || ''), msg = String(e && e.message || '').replace(/\s+/g, ' ').slice(0, 300);
      console.error('[appl] ' + req.method + ' ' + String(req.url || '').split('?')[0] + ' failed: ' + name + ': ' + msg);   // this is the line to look for in the Vercel Logs
      if (/^Blob/.test(name) || /blob|store|quota|limit|suspend|token/i.test(msg)) return reply(res, json(503, { error: 'storage' }));   // the score store itself is unavailable (for example a free-plan limit)
    }
    return reply(res, json(status, { error: status === 500 ? 'server' : 'bad' }));
  }
}
