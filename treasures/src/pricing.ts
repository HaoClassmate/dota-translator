import catalog from './treasurePrices.json' with { type: 'json' };

export type Currency = 'EUR' | 'USD';
type Price = { EUR: number | null; USD: number | null; basis: string; source: string; chestUSD?: number; keyUSD?: number };
export const PRICES: Record<string, Price> = catalog;
const DEFAULT_EUR_OPENING_PRICE = 265;
const DEFAULT_USD_OPENING_PRICE = 299;

export function openingCostCents(treasureId: number, openings: number, currency: Currency): number | null {
  if (!Number.isSafeInteger(openings) || openings < 0) throw Error('Invalid opening count');
  if (openings === 0) return 0;
  const entry = PRICES[treasureId];
  if (!entry) return null;
  const price = currency === 'EUR' ? entry.EUR ?? DEFAULT_EUR_OPENING_PRICE
    : entry.basis === 'chest-and-key'
      ? entry.chestUSD != null && entry.keyUSD != null ? entry.chestUSD + entry.keyUSD : null
      : entry.USD ?? DEFAULT_USD_OPENING_PRICE;
  if (price === null) return null;
  if (!Number.isSafeInteger(price) || price < 0) throw Error('Invalid opening price');
  return price * openings;
}

export function listingPriceCents(treasureId: number, currency: Currency): number | null {
  const entry = PRICES[treasureId];
  if (currency === 'USD' && entry?.basis === 'chest-and-key') return entry.chestUSD ?? null;
  return openingCostCents(treasureId, 1, currency);
}

export function totalOpeningCost(histories: Record<number, readonly unknown[]>, currency: Currency) {
  let cents = 0;
  let unpricedOpenings = 0;
  for (const [id, entries] of Object.entries(histories)) {
    const cost = openingCostCents(Number(id), entries.length, currency);
    if (cost === null) unpricedOpenings += entries.length;
    else cents += cost;
  }
  return { cents, unpricedOpenings };
}
