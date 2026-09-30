import generatedCatalog from './treasureCatalog.json' with { type: 'json' };

export type Item = {
  id: number;
  name: string;
  hero: string;
  rarity?: string;
  scale?: number;
  floor?: number;
  curve?: string;
};
export type BonusItem = Item & { rarity: string; scale: number; floor: number };
export type Treasure = {
  id: number;
  name: string;
  year: string;
  releaseDate?: string;
  kind: string;
  icon: string;
  ordinary: Item[];
  bonuses: BonusItem[];
};
const generated = generatedCatalog as Treasure[];

export const TREASURE = 12604;
export const ORDINARY: Item[] = [
  { id: 21261, name: 'Iris of the Equilibrium', hero: 'Ancient Apparition' },
  { id: 21245, name: 'Visions of the Forsaken Flame', hero: 'Ember Spirit' },
  { id: 21266, name: 'Clarity of the Crystal Path', hero: 'Oracle' },
  { id: 21239, name: 'Empiric Incendiary', hero: 'Batrider' },
  { id: 21248, name: 'Sanction of the Winged Harvest', hero: 'Visage' },
  { id: 21252, name: 'Bastion of the Lionsguard', hero: 'Skywrath Mage' },
  { id: 21262, name: 'Magister of the Narrow Fates', hero: 'Razor' },
];
export const BONUS: BonusItem[] = [
  { id: 21244, name: 'Anvil of the Earthwright', hero: 'Earthshaker', rarity: 'Rare', scale: 45, floor: 0.0005 },
  { id: 21242, name: 'Mischief of the Fae Forager', hero: 'Dark Willow', rarity: 'Very Rare', scale: 70, floor: 0.0001 },
  { id: 21246, name: 'Vanguard of the Emerald Insurgence', hero: "Nature's Prophet", rarity: 'Extremely Rare', scale: 105, floor: 0.00005 },
];
export const CARMINE: Treasure = {
  id: TREASURE,
  name: 'Treasure of the Carmine Cascade',
  year: '2018',
  releaseDate: '2018-09-27',
  kind: 'IMMORTAL TREASURE',
  icon: 'econ/tools/oct_2018_treasure',
  ordinary: ORDINARY,
  bonuses: BONUS,
};
export const TREASURES: Treasure[] = [CARMINE, ...generated].sort((a, b) =>
  (b.releaseDate ?? `${b.year}-01-01`).localeCompare(a.releaseDate ?? `${a.year}-01-01`));

export type Opening = { treasure: number; ordinary: number; bonuses: number; time: number };
export type State = { opened: number; seen: number; misses: number[] };
export const EMPTY_STATE = (treasure: Treasure = CARMINE): State => ({
  opened: 0, seen: 0, misses: treasure.bonuses.map(() => 0),
});

function fullMask(treasure: Treasure) { return (1 << treasure.ordinary.length) - 1; }

export function chance(index: number, misses: number, bonuses: BonusItem[] = BONUS): number {
  const bonus = bonuses[index];
  if (!bonus || !Number.isSafeInteger(misses) || misses < 0) throw Error('Invalid bonus counter');
  if (bonus.curve === 'fixed') return bonus.floor;
  if (misses >= bonus.scale) return 1;
  return Math.min(1, Math.max(0, (Math.sin(misses * Math.PI / bonus.scale - Math.PI / 2) + 1) / 2 + bonus.floor));
}

export function remaining(state: State, treasure: Treasure = CARMINE): number[] {
  const seen = state.seen === fullMask(treasure) ? 0 : state.seen;
  return treasure.ordinary.filter((_, i) => !(seen & (1 << i))).map(item => item.id);
}

export function apply(state: State, entry: Opening, treasure: Treasure = CARMINE): State {
  const index = treasure.ordinary.findIndex(item => item.id === entry.ordinary);
  const validBonusMask = (1 << treasure.bonuses.length) - 1;
  if (entry.treasure !== treasure.id || index < 0 || !Number.isSafeInteger(entry.bonuses) ||
      entry.bonuses < 0 || (entry.bonuses & ~validBonusMask) !== 0 || !Number.isSafeInteger(entry.time) ||
      entry.time <= 0 || state.opened >= 10000 || state.misses.length !== treasure.bonuses.length) throw Error('Invalid opening');
  const seen = state.seen === fullMask(treasure) ? 0 : state.seen;
  const bit = 1 << index;
  if (seen & bit) throw Error('Duplicate ordinary reward in cycle');
  return {
    opened: state.opened + 1,
    seen: seen | bit,
    misses: state.misses.map((misses, i) => (entry.bonuses & (1 << i)) ? 0 : misses + 1),
  };
}

export function replay(history: Opening[], treasure: Treasure = CARMINE): State {
  if (!Array.isArray(history)) throw Error('Invalid history');
  return history.reduce((state, entry) => apply(state, entry, treasure), EMPTY_STATE(treasure));
}

function randomIndex(bound: number): number {
  if (!Number.isSafeInteger(bound) || bound < 1) throw Error('Invalid draw bound');
  const range = 0x100000000;
  const limit = range - range % bound;
  const word = new Uint32Array(1);
  do { crypto.getRandomValues(word); } while (word[0] >= limit);
  return word[0] % bound;
}

function randomUnit(): number {
  const words = new Uint32Array(2);
  crypto.getRandomValues(words);
  return ((words[0] >>> 5) * 67108864 + (words[1] >>> 6)) / 9007199254740992;
}

export function draw(state: State, now: number = Date.now(), treasure: Treasure = CARMINE): Opening {
  if (state.opened >= 10000) throw Error('Opening limit reached');
  const pool = remaining(state, treasure);
  const ordinary = pool[randomIndex(pool.length)];
  let bonuses = 0;
  for (let i = 0; i < treasure.bonuses.length; i++) if (randomUnit() < chance(i, state.misses[i], treasure.bonuses)) bonuses |= 1 << i;
  const entry = { treasure: treasure.id, ordinary, bonuses, time: now };
  apply(state, entry, treasure);
  return entry;
}

export function count(history: Opening[], id: number): number {
  return history.reduce((sum, row) => sum + Number(row.ordinary === id ||
    TREASURES.some(treasure => treasure.id === row.treasure &&
      treasure.bonuses.some((bonus, i) => bonus.id === id && !!(row.bonuses & (1 << i))))), 0);
}

export function rewardStats(history: Opening[], id: number, treasure: Treasure = CARMINE) {
  const bonusIndex = treasure.bonuses.findIndex(item => item.id === id);
  if (bonusIndex < 0 && !treasure.ordinary.some(item => item.id === id)) throw Error('Unknown reward');
  let copies = 0;
  let firstOpening: number | null = null;
  let lastOpening: number | null = null;
  history.forEach((entry, index) => {
    const received = entry.ordinary === id || (bonusIndex >= 0 && !!(entry.bonuses & (1 << bonusIndex)));
    if (!received) return;
    copies++;
    firstOpening ??= index + 1;
    lastOpening = index + 1;
  });
  return { copies, firstOpening, lastOpening, duplicates: Math.max(0, copies - 1) };
}
