import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';
import HERO_MODELS from './heroModels.json' with { type: 'json' };
import { apply, BONUS, chance, count, draw, EMPTY_STATE, ORDINARY, remaining, replay, rewardStats, TREASURE, TREASURES, type Opening } from './treasure.ts';
import { ELIMINATION_DELAY_MS, eliminationOrder, eliminationStepMs, revealTime,
  REVEAL_DELAY_MS, SPIN_MUSIC_DURATION_MS, SPIN_UP_MS, winners, revealRewards } from './spin.ts';

test('ordinary rewards do not repeat until all seven are drawn', () => {
  let state = EMPTY_STATE();
  const history: Opening[] = [];
  for (let i = 0; i < 21; i++) {
    assert.equal(remaining(state).length, 7 - i % 7);
    const entry = { treasure: TREASURE, ordinary: remaining(state)[0], bonuses: 0, time: i + 1 };
    state = apply(state, entry);
    history.push(entry);
    assert.deepEqual(replay(history), state);
  }
  assert.equal(count(history, ORDINARY[0].id), 3);
  assert.equal(remaining(state).length, 7);
});

test('each bonus follows the installed odds curve and resets independently', () => {
  assert.ok(Math.abs(chance(0, 0) - 1 / 2000) < 1e-14);
  assert.ok(Math.abs(chance(1, 0) - 1 / 10000) < 1e-14);
  assert.ok(Math.abs(chance(2, 0) - 1 / 20000) < 1e-14);
  assert.ok(Math.abs(1 / chance(0, 9) - 10.417588752131781) < 1e-10);
  BONUS.forEach((bonus, i) => assert.equal(chance(i, bonus.scale), 1));
  const state = apply({ opened: 4, seen: 1, misses: [4, 7, 10] },
    { treasure: TREASURE, ordinary: ORDINARY[1].id, bonuses: 5, time: 22 });
  assert.deepEqual(state.misses, [0, 8, 0]);
});

test('draws, saved history, and invalid duplicate protection', () => {
  let state = EMPTY_STATE();
  const history: Opening[] = [];
  for (let i = 0; i < 7; i++) {
    const entry = draw(state, i + 1);
    history.push(entry);
    state = apply(state, entry);
  }
  assert.equal(new Set(history.map(x => x.ordinary)).size, 7);
  assert.deepEqual(replay(history), state);
  assert.throws(() => replay([history[0], history[0]]), /Duplicate/);
  assert.throws(() => apply(EMPTY_STATE(), { ...history[0], bonuses: 8 }), /Invalid/);
});

test('the visual spin features a won bonus and reveals every award individually', () => {
  const opening = { treasure: TREASURE, ordinary: ORDINARY[3].id, bonuses: 5, time: 123456 };
  const keep = winners(opening);
  const order = eliminationOrder(opening);
  assert.deepEqual(keep, [ORDINARY[3].id, BONUS[0].id, BONUS[2].id]);
  assert.equal(order.length, ORDINARY.length + BONUS.length - 1);
  assert.deepEqual(revealRewards(opening), [BONUS[2].id, BONUS[0].id, ORDINARY[3].id]);
  assert.equal(new Set([BONUS[2].id, ...order]).size, ORDINARY.length + BONUS.length);
  assert.ok(!order.includes(BONUS[2].id));
  assert.equal(revealTime(opening), SPIN_MUSIC_DURATION_MS);
  assert.equal(SPIN_UP_MS + ELIMINATION_DELAY_MS +
    order.length * eliminationStepMs(order.length) + REVEAL_DELAY_MS, SPIN_MUSIC_DURATION_MS);
});

test('treasures with more heroes eliminate them faster and finish with the music', () => {
  const counts = TREASURES.map(treasure => treasure.ordinary.length + treasure.bonuses.length - 1);
  const fewest = Math.min(...counts);
  const most = Math.max(...counts);
  assert.ok(eliminationStepMs(most) < eliminationStepMs(fewest));
  for (const treasure of TREASURES) {
    const opening = { treasure: treasure.id, ordinary: treasure.ordinary[0].id, bonuses: 0, time: 1 };
    assert.equal(revealTime(opening, treasure), SPIN_MUSIC_DURATION_MS);
  }
});

test('per-reward statistics use the first actual receipt and whole-cent key costs', () => {
  const history: Opening[] = [
    { treasure: TREASURE, ordinary: ORDINARY[0].id, bonuses: 0, time: 1 },
    { treasure: TREASURE, ordinary: ORDINARY[1].id, bonuses: 0, time: 2 },
    { treasure: TREASURE, ordinary: ORDINARY[2].id, bonuses: 1, time: 3 },
    { treasure: TREASURE, ordinary: ORDINARY[3].id, bonuses: 1, time: 4 },
  ];
  assert.deepEqual(rewardStats(history, BONUS[0].id), { copies: 2, firstOpening: 3, lastOpening: 4, duplicates: 1 });
  assert.deepEqual(rewardStats(history, ORDINARY[1].id), { copies: 1, firstOpening: 2, lastOpening: 2, duplicates: 0 });
  assert.deepEqual(rewardStats(history, BONUS[2].id), { copies: 0, firstOpening: null, lastOpening: null, duplicates: 0 });

});


for (const treasure of TREASURES) {
  test(`${treasure.name}: all award combinations survive presentation and history`, () => {
    for (let mask = 0; mask < (1 << treasure.bonuses.length); mask++) {
      const entry = { treasure: treasure.id, ordinary: treasure.ordinary[0].id, bonuses: mask, time: 1 };
      const expected = [entry.ordinary, ...treasure.bonuses.filter((_, i) => mask & (1 << i)).map(b => b.id)];
      const reveals = revealRewards(entry, treasure);
      assert.deepEqual(reveals, expected.reverse());
      assert.equal(new Set(reveals).size, reveals.length);
      assert.ok(!eliminationOrder(entry, treasure).includes(reveals[0]));
      const state = replay(JSON.parse(JSON.stringify([entry])), treasure);
      treasure.bonuses.forEach((bonus, i) => {
        assert.equal(state.misses[i], mask & (1 << i) ? 0 : 1);
        assert.equal(rewardStats([entry], bonus.id, treasure).copies, mask & (1 << i) ? 1 : 0);
      });
    }
  });

  test(`${treasure.name}: worst-case rolls still award each rare by its curve limit`, t => {
    const escalating = treasure.bonuses.filter(bonus => bonus.curve !== 'fixed');
    t.mock.method(crypto, 'getRandomValues', (words: Uint32Array) => {
      // Regular pool selection succeeds; bonus roll is the largest value below 1.
      words.fill(words.length === 1 ? 0 : 0xffffffff);
      return words;
    });
    let state = EMPTY_STATE(treasure);
    const history: Opening[] = [];
    const limit = Math.max(0, ...escalating.map(b => b.scale)) + 1;
    for (let opening = 1; opening <= limit; opening++) {
      const entry = draw(state, opening, treasure);
      history.push(entry);
      state = apply(state, entry, treasure);
      treasure.bonuses.forEach((bonus, i) => {
        if (bonus.curve === 'fixed') return;
        if (opening === bonus.scale + 1) assert.ok(entry.bonuses & (1 << i));
      });
    }
    escalating.forEach(bonus => {
      assert.equal(rewardStats(history, bonus.id, treasure).firstOpening, bonus.scale + 1);
      if (bonus.rarity === 'Rare') assert.ok(rewardStats(history.slice(0, 49), bonus.id, treasure).copies > 0);
    });
  });

  test(`${treasure.name}: sampled rolls agree with displayed probabilities for every bonus`, t => {
    let seed = 0x12ab34cd;
    t.mock.method(crypto, 'getRandomValues', (words: Uint32Array) => {
      for (let i = 0; i < words.length; i++) {
        seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
        words[i] = seed >>> 0;
      }
      return words;
    });
    const state = { ...EMPTY_STATE(treasure), misses: treasure.bonuses.map(() => 9) };
    const samples = 20000;
    const hits = treasure.bonuses.map(() => 0);
    for (let n = 0; n < samples; n++) {
      const entry = draw(state, n + 1, treasure);
      hits.forEach((_, i) => { if (entry.bonuses & (1 << i)) hits[i]++; });
    }
    treasure.bonuses.forEach((bonus, i) => {
      const p = chance(i, 9, treasure.bonuses);
      const expected = samples * p;
      assert.ok(Math.abs(hits[i] - expected) < 6 * Math.sqrt(samples * p * (1 - p)) + 5,
        `${bonus.name}: ${hits[i]}/${samples} versus ${p}`);
    });
  });
}

test('recorded rare and ultra-rare table checkpoints match the configured curves', () => {
  const winter = TREASURES.find(t => t.name === "Winter 2024 Heroes' Hoard")!;
  const vileIndex = winter.bonuses.findIndex(b => b.name === 'Vile Vessel');
  assert.ok(vileIndex >= 0);
  [2000, 583, 187, 88, 51, 33, 23].forEach((denominator, misses) => {
    assert.equal(Math.ceil(1 / chance(vileIndex, misses, winter.bonuses)), denominator);
  });
  assert.equal((1 / chance(vileIndex, 39, winter.bonuses)).toFixed(1), '1.0');
  // Rounded 1:1.0 is not itself a 100% guarantee at opening 40.
  assert.ok(chance(vileIndex, 39, winter.bonuses) > .95 && chance(vileIndex, 39, winter.bonuses) < .96);
  const ultra = winter.bonuses.findIndex(b => b.rarity === 'Ultra Rare');
  [100000, 27380, 8614, 4021, 2303, 1486, 1037].forEach((denominator, misses) => {
    assert.equal(Math.ceil(Math.fround(1 / chance(ultra, misses, winter.bonuses))), denominator);
  });
});

test('Crimson Witness treasures award exactly one of five standard rewards per opening', () => {
  for (const [year, id, rewardIds] of [
    ['2024', 32608, [32606, 32607, 32538, 32539, 32540]],
    ['2025', 36016, [35533, 31206, 35387, 31205, 35392]],
    ['2026', 37112, [35389, 35990, 35988, 37108, 35264]],
  ] as const) {
    const treasure = TREASURES.find(entry => entry.id === id)!;
    assert.equal(treasure.name, `Treasure of the Crimson Witness ${year}`);
    assert.deepEqual(treasure.ordinary.map(item => item.id), rewardIds);
    assert.deepEqual(treasure.bonuses, []);
    const opening = { treasure: id, ordinary: rewardIds[0], bonuses: 0, time: 1 };
    assert.deepEqual(revealRewards(opening, treasure), [rewardIds[0]]);
    assert.deepEqual(winners(opening, treasure), [rewardIds[0]]);
    assert.deepEqual(replay([opening], treasure).misses, []);
  }
});

test("Dragon's Hoard ends with Ancient Dragon King, without the hidden Dragon's Gift envelope", () => {
  const treasure = TREASURES.find(item => item.id === 27046)!;
  assert.equal(treasure.ordinary.length, 14);
  assert.deepEqual(treasure.bonuses.map(item => item.id), [28140, 29116, 26942, 24119]);
});

test("treasure gallery is ordered by full release date, newest first", () => {
  assert.equal(TREASURES[0].name, "Treasure of the Crimson Witness 2026");
  for (let i = 1; i < TREASURES.length; i++) assert.ok(TREASURES[i - 1].releaseDate! >= TREASURES[i].releaseDate!);
});

test('every active reward has item art and every referenced 3D model is present', () => {
  const assets = new URL('../../docs/treasures/assets/', import.meta.url);
  const items = TREASURES.flatMap(treasure => [...treasure.ordinary, ...treasure.bonuses]);
  const ids = new Set(items.map(item => String(item.id)));
  assert.deepEqual(ids, new Set(Object.keys(HERO_MODELS)));
  for (const item of items) {
    assert.ok(existsSync(new URL(`${item.id}.png`, assets)), `Missing item artwork for ${item.id}`);
    const definition = HERO_MODELS[String(item.id) as keyof typeof HERO_MODELS];
    for (const model of definition.models) {
      assert.ok(model.startsWith('/treasures/assets/'), `Unexpected model path for ${item.id}: ${model}`);
      const compressed = new URL(`${model.slice('/treasures/assets/'.length)}.gz`, assets);
      assert.ok(existsSync(compressed), `Missing model for ${item.id}: ${model}`);
      const glb = gunzipSync(readFileSync(compressed));
      const jsonLength = glb.readUInt32LE(12);
      const metadata = JSON.parse(glb.subarray(20, 20 + jsonLength).toString('utf8'));
      for (const image of metadata.images ?? []) {
        if (!image.uri) continue;
        assert.ok(image.uri.endsWith('.webp'), `Unoptimized texture in ${model}: ${image.uri}`);
        assert.ok(existsSync(new URL(image.uri, compressed)), `Missing texture in ${model}: ${image.uri}`);
      }
    }
  }
});

test('every treasure completes three ordinary cycles without duplicates and replays identically', () => {
  for (const treasure of TREASURES) {
    let state = EMPTY_STATE(treasure);
    const history: Opening[] = [];
    const size = treasure.ordinary.length;
    for (let cycle = 0; cycle < 3; cycle++) {
      const received = new Set<number>();
      for (let index = 0; index < size; index++) {
        const entry = draw(state, history.length + 1, treasure);
        assert.ok(!received.has(entry.ordinary), `${treasure.name}: repeated ordinary reward within cycle`);
        received.add(entry.ordinary);
        history.push(entry);
        state = apply(state, entry, treasure);
      }
      assert.equal(received.size, size);
      assert.deepEqual(replay(history, treasure), state);
    }
  }
});
