/**
 * 練習相手（ボット）。
 *
 * Phase 1 の時点では他のユーザーがいない。母数が無いまま対戦を出すなら、
 * **練習相手だと画面に出す**のが条件（DESIGN.md §4）。ここで作る個体には
 * 必ず practice: true が付いていて、view 側はそれを見て文言を出す。
 *
 * ボットも fighter.js の statsFor を通す。ボット専用の強さ計算を持たせると、
 * 「なぜか練習相手だけ硬い」が調整不能になる。
 */
import { CLASS_IDS } from './classes.js';
import { statsFor, STAT_WEIGHTS } from './fighter.js';
import { intBetween, pick, rngFrom, hashSeed } from './rng.js';
import { label } from './i18n.js';

/**
 * 相手の顔ぶれ。系統と技の組み合わせだけで性格を出す。
 *
 * quirk は練習相手だけが持つ癖。`weaken` は攻撃力を削る弱体を撒く
 * ── 「記憶術」に振り払う相手を用意するために置いている。
 *
 * **key は名前と別に持つ。** 戦闘の種は相手の id から作るので、名前を
 * 言語で切り替えると同じ日の戦いが日本語と英語で違う結果になってしまう
 * ── id に入れるのは key のほうで、name は見え方でしかない。
 */
const ROSTER = [
  { key: 'logEater', ja: 'ログ喰い', en: 'Log Eater', class: 'artisan', skills: ['fortitude', 'summon', 'foresight'] },
  { key: 'linter', ja: 'リンタ', en: 'The Linter', class: 'architect', skills: ['fortitude', 'mnemonic'], quirk: 'weaken' },
  { key: 'crawler', ja: 'クローラ', en: 'Crawler', class: 'seeker', skills: ['foresight', 'summon', 'fortitude'] },
  { key: 'indexer', ja: '索引の主', en: 'Keeper of the Index', class: 'scholar', skills: ['mnemonic', 'fortitude', 'summon'] },
  { key: 'doubler', ja: '分身使い', en: 'Forkwright', class: 'commander', skills: ['summon', 'fortitude', 'foresight'] },
  { key: 'nightWatch', ja: '夜警', en: 'Night Watch', class: 'seeker', skills: ['nightVision', 'foresight', 'fortitude'], quirk: 'weaken' },
  { key: 'timeout', ja: 'タイムアウト', en: 'Timeout', class: 'artisan', skills: ['summon', 'fortitude'], quirk: 'weaken' },
  { key: 'diffGhost', ja: '差分の亡霊', en: 'Ghost of a Diff', class: 'architect', skills: ['fortitude', 'mnemonic', 'summon'] },
];

/**
 * 相手が持ち出す技。**こちらの育ち方に合わせる。**
 *
 * 前はレベルだけで決めていた（Lv20 以上なら ★3 を 2〜3 つ）。これだと、技の
 * 伸びが遅い使い方をしている人ほど一方的に負ける ── 実測で **Lv50 の学者が
 * 練習相手に 9%**、Lv100 で 8%。1 日 1 戦だった頃は年に 100 回の話だったが、
 * 2 時間ごとになると「いつ見ても負けている」になる。
 *
 * かといって相手を弱くすると、技が育ちきった人が勝ち続けて退屈になる
 * （2 つ固定にしていた頃の勝率 76%）。
 *
 * だから練習相手は**いまの自分と同じくらい育った相手**にして、勝ち負けを
 * 決めるのはレベルの振れ幅（下の gapFor）だけにした。技を伸ばした人は
 * その伸びぶんだけ強い相手と当たる ── 有利にも不利にもならない。
 * レベルの下駄は残す（育ち始めに ★3 が並ぶと何も起きない）。
 */
function loadoutFor(level, mySkills) {
  const mine = Array.isArray(mySkills) ? mySkills.filter((s) => s && s.tier > 0) : [];
  const capCount = level >= 30 ? 3 : 2;
  const capTier = level >= 20 ? 3 : level >= 8 ? 2 : 1;

  if (!mine.length) return { count: Math.min(1, capCount), tier: 1 };

  const avg = mine.reduce((acc, s) => acc + s.tier, 0) / mine.length;
  return {
    count: Math.max(1, Math.min(capCount, mine.length)),
    tier: Math.max(1, Math.min(capTier, Math.round(avg))),
  };
}

/**
 * 相手の装備。**総取り分はこちらと同じ**にして、配り方だけ相手の形に寄せる。
 *
 * 均等に割ると、どの相手も同じ形の装備を着けていることになって、
 * 「今日の相手は硬かった」が装備からは出てこない。系統の重みで配ると、
 * 学者の相手は守りに厚く、探索者の相手は速さに厚くなる。
 */
function spreadFor(classId, weight) {
  const shape = STAT_WEIGHTS[classId] || { atk: 1, def: 1, spd: 1 };
  const total = shape.atk + shape.def + shape.spd;
  const out = {};
  for (const stat of ['atk', 'def', 'spd']) out[stat] = 1 + (weight * shape[stat]) / total;
  return out;
}

/** ボットの系統ベクトル。1 系統に振り切った状態を作る。 */
function vectorFor(classId) {
  const v = {};
  for (const id of CLASS_IDS) v[id] = id === classId ? 1 : 0;
  return v;
}

/**
 * 相手を 1 体作る。level は挑む側のレベル。
 *
 * **格上寄りに広く振る（Lv20 なら -2 〜 +5）。** 毎回きっちり同格だと、勝ち負けが
 * 技や系統の差ではなく乱数だけで決まっているように見える。かといって
 * 相手のレベルを見せてしまうと「あと何レベルで勝てる」が計算できてしまい、
 * 負けた時点でその日は終わる。**強さを見せずに広く振る**のが、
 * 「どこまでやれば勝てるのか分からない」を作る条件（DESIGN.md §5d）。
 *
 * **振り幅はレベルに比例させる。** ステータスはレベルに比例して伸びるので、
 * 「+5」の重みは Lv20 と Lv60 で別物になる ── 固定幅にしていた頃、Lv20 では
 * +8 の相手に勝率 0%、Lv50 では +8 に 78% で、育つほどレベル差が意味を失っていた。
 */
// 下限を 3 / 4 にしていた頃、Lv5 では実質 -60%〜+80% の幅になっていて、
// +4 を引いた日はステータス差 47% で最初から詰んでいた（勝率 43%・9 連敗）。
const down = (level) => Math.max(1, Math.round(level * 0.15));
const up = (level) => Math.max(2, Math.round(level * 0.22));

/** 相手を配る単位。7 戦ぶん（2 時間ごとなので、だいたい半日〜1 日）。 */
const CYCLE = 7;

/**
 * **7 戦ぶんのレベル差を、まとめて配る。**
 *
 * 毎回ばらばらに引くと、運が悪いと格上ばかりが続く ── 実測で 180 日のうちに
 * **13 連敗**が出た。眺めるだけの相棒がずっと負け続けるのは、
 * 「ブレなければ報われる」の逆をやっている。
 *
 * かといって「負けた次は弱くする」は戦績を state に持つことになる（§9 の未決）。
 * 代わりに、範囲を 7 等分して**各区画から 1 戦ずつ**引き、順番だけ混ぜる。
 * こうすると 7 戦の中に必ず格下も格上も来る ── どれが当たりかは分からないまま、
 * 「ずっと勝てない日」だけが消える。保存するものは何も増えない。
 */
export function cycleGaps(level, seed) {
  const rng = rngFrom(seed);
  const lo = -down(level);
  const hi = up(level);
  const span = (hi - lo) / CYCLE;

  const slots = [];
  for (let i = 0; i < CYCLE; i += 1) {
    const from = lo + span * i;
    slots.push(Math.round(from + rng() * span));
  }
  // 区画の順に出すと「頭は必ず格下」になってしまう。順番だけ混ぜる。
  for (let i = slots.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [slots[i], slots[j]] = [slots[j], slots[i]];
  }
  return slots;
}

/** 前の名前のまま呼ばれても動くようにしておく（配る単位が日から戦に変わった）。 */
export const weeklyGaps = cycleGaps;

/**
 * この一戦のレベル差。slotNumber を渡さなければ、その場で 1 つ引く
 * （テストや scripts/battle.mjs のように「いま何戦目か」が無いところ用）。
 */
export function gapFor(level, rng, slotNumber = null, cycleSeed = 0) {
  if (slotNumber === null) return intBetween(rng, -down(level), up(level));
  const cycle = Math.floor(slotNumber / CYCLE);
  const slots = cycleGaps(level, hashSeed(`${cycleSeed}:${cycle}`));
  return slots[((slotNumber % CYCLE) + CYCLE) % CYCLE];
}

export function botFor(level, rng, { slotNumber = null, cycleSeed = 0, lang = 'ja', skills = null, gear = 0 } = {}) {
  const entry = pick(rng, ROSTER);
  const botLevel = Math.max(1, level + gapFor(level, rng, slotNumber, cycleSeed));
  const loadout = loadoutFor(botLevel, skills);
  /*
   * 装備の取り分も合わせる。**同じだけ持たせるが、配り方は相手の形に従う**
   * ── こちらが攻に寄せた装備でも、相手は自分の系統に合わせて配る。
   * 合わせないと、潜れば潜るほど一方的に勝つだけの相手になる（技と同じ話）。
   */
  const spread = spreadFor(entry.class, gear);
  return {
    // 種に入るのは key。名前（見え方）を入れると言語で結果が変わる
    id: `bot-${entry.key}`,
    name: label(entry, lang),
    level: botLevel,
    class: entry.class,
    stats: statsFor(botLevel, vectorFor(entry.class), spread),
    skills: entry.skills.slice(0, loadout.count).map((id) => ({ id, tier: loadout.tier })),
    seed: botLevel,
    practice: true,
    quirk: entry.quirk || null,
  };
}
