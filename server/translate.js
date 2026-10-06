// Translation for the remote receiver: the prompt (from a file, re-read when
// it changes), the recent chat given as context, one OpenAI-compatible call.
// Shared by index.js and retranslate.mjs, so a prompt is tested exactly as
// it will run.

import fs from 'node:fs';

// Mostly Chinese already: shown as it is, no call.
export const isChinese = (t) => {
  const han = (t.match(/[一-鿿]/g) || []).length;
  const letters = (t.match(/[A-Za-zÀ-ɏЀ-ӿ฀-๿가-힯]/g) || []).length;
  return han > 0 && han >= letters;
};
// Nothing to translate: digits, punctuation, "?" spam.
export const isTrivial = (t) => !/[\p{L}]/u.test(t);

const SLOT_ZH = ['蓝', '青', '紫', '黄', '橙', '粉', '橄榄', '浅蓝', '绿', '棕'];

// How a line is shown to the model: channel, side and seat, so it can tell
// who answers whom.
export function label(l) {
  const who = `${l.slot < 5 ? '天辉' : '夜魇'}${SLOT_ZH[l.slot] ?? l.slot}${l.self ? '(我)' : ''}${l.hero ? '/' + l.hero : ''}`;
  return `[${l.channel === 'team' ? '队伍' : '全体'}] ${who}: ${l.text}`;
}

// The lines said just before `line` in the same match: a one-word line
// ("torm", "next", "g") is only readable next to them.
export function contextFor(lines, line, { max = 8, withinMs = 3 * 60 * 1000 } = {}) {
  const out = [];
  for (let i = lines.indexOf(line) - 1; i >= 0 && out.length < max; i--) {
    const l = lines[i];
    if (l.match !== line.match || line.at - l.at > withinMs) break;
    out.unshift(l);
  }
  return out;
}

export function userMessage(line, context) {
  const parts = [];
  if (context.length) parts.push('最近的聊天（只用来理解上下文，不要翻译）：', ...context.map(label), '');
  parts.push('要翻译的消息：', label(line));
  return parts.join('\n');
}

export function createTranslator({ url, key, model, promptFile = '', defaultPrompt = '' }) {
  let prompt = defaultPrompt, mtime = 0;
  function currentPrompt() {
    if (!promptFile) return prompt;
    try {
      const m = fs.statSync(promptFile).mtimeMs;
      if (m !== mtime) {
        const text = fs.readFileSync(promptFile, 'utf8').trim();
        mtime = m;
        if (text && text !== prompt) { prompt = text; console.log('prompt loaded from', promptFile); }
      }
    } catch (err) { if (mtime !== -1) { mtime = -1; console.warn('prompt file:', err.message); } }
    return prompt;
  }

  // No cache: the same "come" means something else in another context.
  return async function translate(line, context = []) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 200,
        messages: [{ role: 'system', content: currentPrompt() }, { role: 'user', content: userMessage(line, context) }],
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = await res.json();
    // The model sometimes echoes the label it was shown: never part of a translation.
    return String(json?.choices?.[0]?.message?.content || '').trim()
      .replace(/^\[(队伍|全体)\]\s*[^:：]{0,24}[:：]\s*/, '');
  };
}
