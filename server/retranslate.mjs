// Re-translate saved lines with a prompt, old next to new: how a prompt
// change is checked against real games before it goes live.
//
//   set -a; . /etc/dota-chat.env; set +a
//   node server/retranslate.mjs /var/lib/dota-chat/lines.json --prompt server/prompt.txt "cm man" torm
//   node server/retranslate.mjs /var/lib/dota-chat/lines.json --prompt server/prompt.txt --match 9030907843
//   node server/retranslate.mjs lines.json --prompt new.txt --base /etc/dota-chat.prompt --all   (两份提示词对比，只列出不同的)
//
// Texts select lines whose text is exactly that; --match takes a whole game.
// Context is the same as live: the lines before it in that match.

import fs from 'node:fs';
import { createTranslator, contextFor, isChinese, isTrivial } from './translate.js';

const args = process.argv.slice(2);
const file = args.shift();
const opt = (name) => { const i = args.indexOf(name); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
const promptFile = opt('--prompt') || process.env.PROMPT_FILE;
const match = opt('--match');
const basePrompt = opt('--base');
const all = args.includes('--all') && args.splice(args.indexOf('--all'), 1);
const texts = new Set(args);

const lines = JSON.parse(fs.readFileSync(file, 'utf8'));
const picked = lines.filter((l) => (all ? l.channel !== 'ocr' : match ? l.match === match : texts.has(l.text)) && !isChinese(l.text) && !isTrivial(l.text));
const make = (promptFile) => createTranslator({ url: process.env.LLM_API_URL, key: process.env.LLM_API_KEY, model: process.env.LLM_MODEL, promptFile });
const translate = make(promptFile);
const translateBase = basePrompt ? make(basePrompt) : null;

let next = 0;
const results = new Array(picked.length);
await Promise.all(Array.from({ length: 5 }, async () => {
  while (next < picked.length) {
    const i = next++;
    const l = picked[i];
    try { results[i] = await translate(l, contextFor(lines, l)); } catch (err) { results[i] = 'ERROR ' + err.message; }
    // 和另一份提示词对比时，"旧"就是它的译文，而不是存下来的
    if (translateBase) { try { l.zh = await translateBase(l, contextFor(lines, l)); } catch (err) { l.zh = 'ERROR ' + err.message; } }
  }
}));
picked.forEach((l, i) => {
  const mark = results[i] === l.zh ? ' ' : '*';
  if (translateBase && mark === ' ') return;
  console.log(`${mark} ${l.text}\n    旧: ${l.zh}\n    新: ${results[i]}`);
});
console.log(`\n${picked.length} 条，${results.filter((r, i) => r !== picked[i].zh).length} 条变了（* 标记）`);
