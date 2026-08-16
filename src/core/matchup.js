/**
 * 系統の相性。
 *
 * 5 つを一本の輪にしてある。どの系統にも「強い相手」と「弱い相手」が
 * ちょうど 1 つずつあり、有利不利の総量はどこも同じ ── 系統は働き方の結果で
 * 選べないので、引いた系統によって不利が続く作りにはできない。
 *
 * 効果はバフとデバフを 1 つずつ。有利な側は攻撃が上がり、不利な側は
 * 守りが薄くなる。同じ数字を両方に掛けるより、戦い方が変わって見える。
 */
import { CLASSES, CLASS_IDS } from './classes.js';

/** id → その id が強く出られる相手。ここを一周させるだけで輪になる。 */
const BEATS = {
  artisan: 'architect', // 手を動かす者は、組み上がる前に壊す
  architect: 'scholar', // 設計が、読む対象そのものを決める
  scholar: 'seeker', // 中を読み切っていれば、外を調べる必要がない
  seeker: 'commander', // 先に知っている者は、指示より速い
  commander: 'artisan', // 数で来られると、一人で叩くには多すぎる
};

const REASON = {
  artisan: { ja: '組み上がる前に壊す', en: 'breaks it before it is finished' },
  architect: { ja: '読む対象そのものを決める', en: 'decides what there is to read' },
  scholar: { ja: '中を読み切っていれば 外は要らない', en: 'has read it all already' },
  seeker: { ja: '知っている者は 指示より速い', en: 'already knew, before the order came' },
  commander: { ja: '一人で叩くには 数が多すぎる', en: 'brought too many to fight alone' },
};

/**
 * 有利な側の攻撃に掛かる倍率と、不利な側の守りに掛かる倍率。
 *
 * **小さく見えるが、これでも効きすぎるくらい。** 攻撃 +15% / 守り -12% で
 * 試したら同レベルの勝率が 80% 対 20% になった ── 系統は働き方の結果であって
 * 選べないので、その日の相性で勝負がほぼ決まるのは違う。
 * 「効いているのは分かるが、ひっくり返せる」ところまで落としてある。
 */
export const ADVANTAGE_ATK = 1.07;
export const DISADVANTAGE_DEF = 0.95;

/**
 * a から見た相性。1 = 有利、-1 = 不利、0 = 五分。
 * どちらかが見習い（系統が決まっていない）なら常に 0。
 */
export function matchupFor(a, b) {
  if (!a || !b || a === b) return 0;
  if (!CLASS_IDS.includes(a) || !CLASS_IDS.includes(b)) return 0;
  if (BEATS[a] === b) return 1;
  if (BEATS[b] === a) return -1;
  return 0;
}

/**
 * 表示の材料。**文そのものは組み立てない**（語順が言語で違うので、
 * 文は i18n.js の `log.matchup` が持つ）。
 */
export function matchupText(winner, loser) {
  if (!CLASSES[winner] || !CLASSES[loser]) return null;
  return { winner: CLASSES[winner], loser: CLASSES[loser], reason: REASON[winner] };
}
