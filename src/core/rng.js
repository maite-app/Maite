/**
 * 決定論的な乱数。
 *
 * 戦闘は「同じ 2 体 × 同じ日なら、何度計算しても同じ結果」でなければならない。
 * 結果を保存せずに毎回導出できるのはこの性質のおかげで、Phase 2 で相手の
 * スナップショットだけ持ってきてクライアント側で解決できるのも同じ理由。
 *
 * Math.random() は使わない ── 使った瞬間に再現できなくなる。
 */

/** mulberry32。状態が 32bit 1 つだけで、実装が短く、質は十分。 */
export function rngFrom(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 文字列を 32bit に潰す（FNV-1a）。日付や ID を種に混ぜるために使う。 */
export function hashSeed(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** min..max の整数（両端を含む）。 */
export function intBetween(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

export function pick(rng, list) {
  return list[Math.floor(rng() * list.length)];
}
