// Plays Dota for the receiver: POSTs GSI payloads with chat events.
//   node server/fakegsi.mjs http://127.0.0.1:47854/ <token> "ss mid b" "bobo ka talaga"
//   MATCH=456 STATE=DOTA_GAMERULES_STATE_POST_GAME node server/fakegsi.mjs ...
const [url, token, ...said] = process.argv.slice(2);
const events = [];
const post = (body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const payload = () => ({
  provider: { name: 'Dota 2', appid: 570 },
  map: { matchid: process.env.MATCH || '123', game_state: process.env.STATE || 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS' },
  player: { steamid: '76561198000000000', name: 'me', team_name: 'radiant', team_slot: 0 },
  hero: { name: 'npc_dota_hero_lina' },
  events: [...events].reverse(),
  auth: { token },
});
await post(payload());                         // the first payload primes, as Dota's does
for (const [i, text] of said.entries()) {
  events.push({ game_time: 100 + i, event_type: 'chat_message', player_id: (i * 3) % 10, channel_type: i % 2 ? 11 : 12, message: text });
  await post(payload());
}
console.log('sent', said.length);
