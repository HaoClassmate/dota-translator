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

const env = process.env;
const PORT = Number(env.PORT) || 47854;
const HOST = env.HOST || '0.0.0.0';
const TOKEN = env.GSI_TOKEN || '';
const LLM_URL = env.LLM_API_URL || 'https://api.deepseek.com/chat/completions';
const LLM_KEY = env.LLM_API_KEY || '';
const LLM_MODEL = env.LLM_MODEL || 'deepseek-chat';
const KEEP = 300;

if (!TOKEN) { console.error('GSI_TOKEN is required: it keeps strangers out of the feed and the page.'); process.exit(1); }
if (!LLM_KEY) console.warn('LLM_API_KEY is not set: lines are shown untranslated.');

const PAGE = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'page.html'), 'utf8');

const lines = [];
const clients = new Set();
let nextId = 1;
let lastFeed = 0;

function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(msg);
}

// Mostly Chinese already: shown as it is, no call.
const isChinese = (t) => {
  const han = (t.match(/[一-鿿]/g) || []).length;
  const letters = (t.match(/[A-Za-zÀ-ɏЀ-ӿ฀-๿가-힯]/g) || []).length;
  return han > 0 && han >= letters;
};
// Nothing to translate: digits, punctuation, "?" spam.
const isTrivial = (t) => !/[\p{L}]/u.test(t);

const PROMPT = [
  '你是 Dota 2 东南亚服务器的聊天翻译。把玩家发的消息翻译成简体中文，口语化、简短，保留语气（包括骂人）。',
  '消息可能是英语、菲律宾语(Tagalog/Taglish)、印尼语、马来语、泰语、俄语、越南语或混杂，以及大量缩写和游戏黑话（ss/mia=敌人消失, b=撤退, bb=买活, rosh=肉山, ff=投降, ez, gg, noob, bobo, gago, tanga, pota, anjing, goblok, babi, bodoh 等）。',
  '英雄、物品、技能名用国服常用叫法。只输出译文本身，不要解释、不要引号。如果看不懂就输出原文。',
].join('\n');

const cache = new Map();
async function translate(text) {
  if (cache.has(text)) return cache.get(text);
  const res = await fetch(LLM_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${LLM_KEY}` },
    body: JSON.stringify({
      model: LLM_MODEL,
      temperature: 0.2,
      max_tokens: 200,
      messages: [{ role: 'system', content: PROMPT }, { role: 'user', content: text }],
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  const out = String(json?.choices?.[0]?.message?.content || '').trim();
  if (cache.size > 2000) cache.clear();
  cache.set(text, out);
  return out;
}

const chat = createGsiChat({
  scripts: ['any'],
  onUnknownChannel: (n) => console.log('unknown channel_type', n),
  onMessage: (m) => {
    const line = { id: nextId++, at: Date.now(), name: m.name, hero: m.hero || null, slot: m.slot, channel: m.channel, text: m.text, zh: null, state: 'pending' };
    if (isChinese(m.text) || isTrivial(m.text)) { line.zh = ''; line.state = 'done'; }
    else if (!LLM_KEY) line.state = 'off';
    lines.push(line);
    if (lines.length > KEEP) lines.shift();
    broadcast('line', line);
    if (line.state !== 'pending') return;
    translate(m.text)
      .then((zh) => { line.zh = zh; line.state = 'done'; })
      .catch((err) => { line.state = 'error'; line.error = String(err.message || err); console.error('translate:', line.error); })
      .finally(() => broadcast('line', line));
  },
});

const tokenIn = (body) => {
  try { return JSON.parse(body)?.auth?.token || ''; } catch { /* malformed, see gsisource.js */ }
  const m = /"auth"\s*:\s*\{\s*"token"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(body);
  return m ? m[1] : '';
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'POST') {
    let body = '';
    let over = false;
    req.setEncoding('utf8');
    req.on('data', (c) => { if (over) return; body += c; if (body.length > 4 * 1024 * 1024) { over = true; body = ''; } });
    req.on('end', () => {
      res.writeHead(200); res.end('ok');
      if (over || tokenIn(body) !== TOKEN) return;
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
    res.write(`event: status\ndata: ${JSON.stringify({ lastFeed })}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
  } else {
    res.writeHead(404); res.end();
  }
});

// Status every few seconds keeps the stream open through proxies and tells
// the page whether Dota is still sending.
setInterval(() => broadcast('status', { lastFeed }), 5000).unref();

server.listen(PORT, HOST, () => console.log(`listening on ${HOST}:${PORT}, model ${LLM_MODEL}`));
