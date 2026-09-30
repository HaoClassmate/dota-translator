import test from 'node:test';
import assert from 'node:assert/strict';
import { listingPriceCents, openingCostCents, totalOpeningCost } from './pricing.ts';

test('opening costs use each EUR price and the photographed USD price', () => {
  assert.equal(openingCostCents(12604, 3, 'EUR'), 657);
  assert.equal(openingCostCents(32609, 3, 'EUR'), 795);
  assert.equal(openingCostCents(32933, 3, 'EUR'), 795);
  assert.equal(openingCostCents(32609, 3, 'USD'), 897);
  assert.equal(openingCostCents(12604, 3, 'USD'), 747);
});

test('existing opening history is totaled per treasure without mutating it', () => {
  const histories = {12604: [{time: 1}, {time: 2}], 32609: [{time: 3}], 32933: [{time: 4}]};
  const before = JSON.stringify(histories);
  assert.deepEqual(totalOpeningCost(histories, 'EUR'), {cents: 968, unpricedOpenings: 0});
  assert.deepEqual(totalOpeningCost(histories, 'USD'), {cents: 1096, unpricedOpenings: 0});
  assert.equal(JSON.stringify(histories), before);
});

test('unknown prices stay unpriced rather than using 2.19 or being presented as free', () => {
  assert.equal(openingCostCents(999999, 1, 'EUR'), null);
  assert.equal(openingCostCents(999999, 0, 'EUR'), 0);
  assert.deepEqual(totalOpeningCost({12604: [1], 999999: [1, 2]}, 'EUR'), {cents: 219, unpricedOpenings: 2});
  assert.throws(() => openingCostCents(12604, -1, 'EUR'));
  assert.throws(() => openingCostCents(12604, 1.5, 'EUR'));
});

test('screenshot prices distinguish store tiers and expensive market-listed treasures', () => {
  for (const [id, cents] of [[37112,15577],[36016,18486],[32608,14950],
    [31200,219],[34332,265],[31361,265],[32658,219],[30279,265],[29639,265],
    [30939,219],[30937,219],[30938,219],[27046,219],
    [23662,161],[23663,416],[23664,92],[23686,86],
    [13796,117],[13795,117],[13780,139],[12604,219]]) {
    assert.equal(openingCostCents(id, 1, 'EUR'), cents, `Treasure ${id}`);
  }
  assert.deepEqual(totalOpeningCost({37112: [1], 23664: [1,2], 31200: [1]}, 'EUR'),
    {cents: 15980, unpricedOpenings: 0});
});

test('USD prices match the supplied Dota screenshots', () => {
  for (const [id, cents] of [[37112,18394],[31200,249],[32933,299],[34332,299],
    [36016,22719],[31361,299],[32658,249],[32609,299],[32608,17553],
    [30279,299],[29639,299],[30939,249],[30937,249],[30938,249],
    [27046,249],[23662,189],[23663,485],[23664,99],[23686,97],
    [13796,126],[13795,131],[13780,139],[12604,249]]) {
    assert.equal(openingCostCents(id, 1, 'USD'), cents, `Treasure ${id}`);
  }
});

test('unpictured treasures use the $2.99 standard and a chest listing excludes its key', () => {
  assert.equal(openingCostCents(23228, 1, 'EUR'), 265);
  assert.equal(listingPriceCents(23228, 'USD'), 3);
  assert.equal(openingCostCents(23228, 1, 'USD'), 302);
  assert.equal(openingCostCents(27435, 3, 'EUR'), 795);
  assert.equal(openingCostCents(27435, 3, 'USD'), 897);
  assert.deepEqual(totalOpeningCost({27435: [1,2], 12604: [1]}, 'EUR'),
    {cents: 749, unpricedOpenings: 0});
  assert.deepEqual(totalOpeningCost({27435: [1,2], 12604: [1]}, 'USD'),
    {cents: 847, unpricedOpenings: 0});
});
