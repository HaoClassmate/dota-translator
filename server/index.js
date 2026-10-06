// A remote receiver: Dota on the game PC sends its GSI feed HERE (another
// machine), chat is translated into Chinese, and a web page shows it live.
// Nothing runs on the game PC but the cfg file (server/README.md).
//
//   GSI_TOKEN=... LLM_API_KEY=... node server/index.js
//
// One port for everything: POST / is Dota's feed (its auth.token must match),
// GET /?k=<token> is the page, GET /events?k=<token> the live stream (SSE).

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGsiChat } from '../src/gsisource.js';
import { createTranslator, contextFor, isChinese, isTrivial } from './translate.js';

const env = process.env;
const PORT = Number(env.PORT) || 47854;
const HOST = env.HOST || '0.0.0.0';
const TOKEN = env.GSI_TOKEN || '';
const LLM_URL = env.LLM_API_URL || 'https://api.deepseek.com/chat/completions';
const LLM_KEY = env.LLM_API_KEY || '';
const LLM_MODEL = env.LLM_MODEL || 'deepseek-chat';
const KEEP = 1000;
// Where the lines are kept across restarts (systemd's StateDirectory).
const STATE_FILE = env.STATE_DIRECTORY ? path.join(env.STATE_DIRECTORY, 'lines.json') : '';
// The system prompt, re-read when the file changes: edit it on the server
// between games to tune the translation, no restart.
const PROMPT_FILE = env.PROMPT_FILE || '';

if (!TOKEN) { console.error('GSI_TOKEN is required: it keeps strangers out of the feed and the page.'); process.exit(1); }
if (!LLM_KEY) console.warn('LLM_API_KEY is not set: lines are shown untranslated.');

const PAGE = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'page.html'), 'utf8');

const lines = [];
const clients = new Set();
let nextId = 1;
let lastFeed = 0;
// Of the payload being read: which match, and whether it is over (post-game
// chat is still chat, and the feed keeps sending it on the end screen).
let matchid = '';
// When the current match was first seen: the page opens its tab right away,
// before anybody has said anything.
let matchSince = 0;
const status = () => ({ lastFeed, match: matchid, since: matchSince });
let gameState = '';

if (STATE_FILE) {
  try {
    for (const l of JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))) {
      if (l.state === 'pending') l.state = 'error', l.error = '服务重启，未翻译';
      lines.push(l);
    }
    nextId = Math.max(0, ...lines.map((l) => l.id)) + 1;
  } catch { /* first start */ }
}
let saving = null;
const save = () => {
  if (!STATE_FILE || saving) return;
  saving = setTimeout(() => {
    saving = null;
    fs.writeFile(STATE_FILE + '.tmp', JSON.stringify(lines), (err) => {
      if (err) return console.error('save:', err.message);
      fs.rename(STATE_FILE + '.tmp', STATE_FILE, () => {});
    });
  }, 2000);
};

function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(msg);
}

// server/prompt.txt is the default; PROMPT_FILE (edited on the server) wins.
const translate = createTranslator({
  url: LLM_URL, key: LLM_KEY, model: LLM_MODEL, promptFile: PROMPT_FILE,
  defaultPrompt: fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'prompt.txt'), 'utf8'),
});

let selfSlot = null;
const chat = createGsiChat({
  scripts: ['any'],
  onSelf: (me) => { selfSlot = me ? me.slot : null; },
  onUnknownChannel: (n) => console.log('unknown channel_type', n),
  onMessage: (m) => {
    console.log('chat:', m.channel, 'slot', m.slot, gameState || '-');
    const line = { id: nextId++, at: Date.now(), match: matchid, post: gameState === 'DOTA_GAMERULES_STATE_POST_GAME', name: m.name, hero: m.hero || null, slot: m.slot, self: m.slot === selfSlot, channel: m.channel, text: m.text, zh: null, state: 'pending' };
    if (isChinese(m.text) || isTrivial(m.text)) { line.zh = ''; line.state = 'done'; }
    else if (!LLM_KEY) line.state = 'off';
    lines.push(line);
    if (lines.length > KEEP) lines.shift();
    broadcast('line', line);
    save();
    if (line.state !== 'pending') return;
    translate(line, contextFor(lines, line))
      .then((zh) => { line.zh = zh; line.state = 'done'; })
      .catch((err) => { line.state = 'error'; line.error = String(err.message || err); console.error('translate:', line.error); })
      .finally(() => { broadcast('line', line); save(); });
  },
});

// Token, match and state of a payload; malformed JSON (see gsisource.js)
// still gives its token.
const readHead = (body) => {
  try {
    const d = JSON.parse(body);
    return { token: d?.auth?.token || '', match: d?.map?.matchid || '', state: d?.map?.game_state || '' };
  } catch { /* below */ }
  const m = /"auth"\s*:\s*\{\s*"token"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(body);
  return { token: m ? m[1] : '', match: null, state: null };
};

// Lines DeepRant read off the screen (its screenshot translation) and already
// translated. The same chat box is captured again and again, so a line seen
// in the last 15 minutes is not added twice.
const OCR_DEDUPE_MS = 15 * 60 * 1000;
function addOcr(items) {
  const now = Date.now();
  const recent = new Set(lines.filter((l) => l.channel === 'ocr' && now - l.at < OCR_DEDUPE_MS).map((l) => l.name + '|' + l.text));
  let added = 0;
  for (const it of Array.isArray(items) ? items : []) {
    const text = String(it?.text || '').trim().slice(0, 500);
    const name = String(it?.name || '').trim().slice(0, 60);
    if (!text || recent.has(name + '|' + text)) continue;
    recent.add(name + '|' + text);
    const line = { id: nextId++, at: now, match: matchid, post: false, name, hero: null, slot: -1, self: false, channel: 'ocr', text, zh: String(it?.zh || '').slice(0, 500), state: 'done' };
    lines.push(line);
    if (lines.length > KEEP) lines.shift();
    broadcast('line', line);
    added++;
  }
  if (added) save();
  return added;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'POST' && url.pathname === '/ocr') {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (c) => { if (body.length < 256 * 1024) body += c; });
    req.on('end', () => {
      let d = null;
      try { d = JSON.parse(body); } catch { /* below */ }
      if (!d || d.token !== TOKEN) { res.writeHead(403); res.end('forbidden'); return; }
      const added = addOcr(d.items);
      console.log('ocr: added', added);
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ added }));
    });
    return;
  }
  if (req.method === 'POST') {
    let body = '';
    let over = false;
    req.setEncoding('utf8');
    req.on('data', (c) => { if (over) return; body += c; if (body.length > 4 * 1024 * 1024) { over = true; body = ''; } });
    req.on('end', () => {
      res.writeHead(200); res.end('ok');
      if (over) return;
      const head = readHead(body);
      if (head.token !== TOKEN) return;
      if (head.match !== null) {
        // Logged so a real game shows what the feed sends when (menu, post-game...).
        if (head.match !== matchid || head.state !== gameState) console.log('feed: match', head.match || '-', 'state', head.state || '-');
        if (head.match !== matchid) { matchSince = Date.now(); matchid = head.match; gameState = head.state; broadcast('status', status()); }
        gameState = head.state;
      }
      if (chat.payload(body)) lastFeed = Date.now();
    });
    return;
  }
  if (url.searchParams.get('k') !== TOKEN) { res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('forbidden'); return; }
  if (url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(PAGE);
  } else if (url.pathname === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write(`event: history\ndata: ${JSON.stringify(lines)}\n\n`);
    res.write(`event: status\ndata: ${JSON.stringify(status())}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
  } else {
    res.writeHead(404); res.end();
  }
});

// Status every few seconds keeps the stream open through proxies and tells
// the page whether Dota is still sending.
setInterval(() => broadcast('status', status()), 5000).unref();

server.listen(PORT, HOST, () => console.log(`listening on ${HOST}:${PORT}, model ${LLM_MODEL}`));
