/**
 * Stable scouting noise (Phase 11): a team's read of a player is a fixed draw
 * from a hash of the league, the viewer, the player and the attribute, scaled
 * by how uncertain the read is today. No random numbers are drawn, so looking
 * at a screen never changes the future, and as a team learns more the same
 * draw shrinks: its read sharpens toward the truth instead of jumping around.
 */
/** FNV-1a (32-bit) of a key, the raw material for the draws below. */
function fnv(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * MurmurHash3's final mix. FNV alone gives related numbers for keys that differ only in their
 * last character ("x:a", "x:b"), so draws wouldn't be independent; the mix spreads every bit.
 */
function mix(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

const TWO_32 = 4294967296;

/** The i-th independent uniform in [0, 1) from one hashed key. */
function nth(h: number, i: number): number {
  return mix((h + Math.imul(i + 1, 0x9e3779b9)) >>> 0) / TWO_32;
}

/** A standard normal draw from a key (four uniforms: close enough to a bell curve, exact arithmetic). */
export function normalFrom(key: string): number {
  const h = fnv(key);
  const sum = nth(h, 0) + nth(h, 1) + nth(h, 2) + nth(h, 3);
  // Four uniforms have mean 2 and variance 1/3.
  return (sum - 2) * Math.sqrt(3);
}

/** A uniform draw from a key, for anything that needs one (also screen-safe). */
export function uniformFrom(key: string): number {
  return nth(fnv(key), 0);
}
