import { CARMINE, type Opening, type Treasure } from './treasure.ts';

// The music track is 11.228 seconds. Pace eliminations so every treasure's
// final reward appears when the track ends, regardless of its reward count.
export const SPIN_UP_MS = 2200;
export const ELIMINATION_DELAY_MS = 700;
export const REVEAL_DELAY_MS = 360;
export const SPIN_MUSIC_DURATION_MS = 11228;

export function eliminationStepMs(eliminations: number): number {
  return (SPIN_MUSIC_DURATION_MS - SPIN_UP_MS - ELIMINATION_DELAY_MS - REVEAL_DELAY_MS) /
    Math.max(1, eliminations);
}

export function winners(opening: Opening, treasure: Treasure = CARMINE): number[] {
  return [opening.ordinary, ...treasure.bonuses.filter((_, i) => opening.bonuses & (1 << i)).map(item => item.id)];
}

// Show every award individually, rarest bonus first, then the regular reward.
export function revealRewards(opening: Opening, treasure: Treasure = CARMINE): number[] {
  return winners(opening, treasure).reverse();
}

export function eliminationOrder(opening: Opening, treasure: Treasure = CARMINE): number[] {
  const featured = revealRewards(opening, treasure)[0];
  const losing = [...treasure.ordinary, ...treasure.bonuses].filter(item => item.id !== featured).map(item => item.id);
  // Shuffle presentation only. This does not draw or change a reward.
  let seed = (opening.time ^ opening.ordinary ^ opening.bonuses) >>> 0;
  for (let i = losing.length - 1; i > 0; i--) {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    const j = (seed >>> 0) % (i + 1);
    [losing[i], losing[j]] = [losing[j], losing[i]];
  }
  return losing;
}

export function revealTime(opening: Opening, treasure: Treasure = CARMINE): number {
  const eliminations = eliminationOrder(opening, treasure).length;
  return SPIN_UP_MS + ELIMINATION_DELAY_MS +
    eliminations * eliminationStepMs(eliminations) + REVEAL_DELAY_MS;
}
