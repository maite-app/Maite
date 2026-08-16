/**
 * state → 戦闘に出る 1 体。
 *
 * ここで作る形は DESIGN.md §2b の「Phase 2 で送信する全量」とわざと同じにしてある。
 * ゴースト戦を足すとき、この関数の戻り値をそのまま送れば済む
 * ── 送る中身が増えないことを、型で担保するための一致。
 *
 * HP を stats に入れていないのも同じ理由。stats は atk/def/spd の 3 つで固定し、
 * HP は受け取った側が level と def から導く（battle.js）。
 */
import { CLASS_IDS } from './classes.js';
import { levelForExp } from './growth.js';
import { skillsFor } from './skills.js';
import { nameFor } from './naming.js';
import { personaFor } from './persona.js';
import { dungeonFor, gearWeightOf } from './dungeon.js';

/**
 * 系統ごとの伸び方。
 *
 * **合計は揃えていない。揃えているのは勝率のほう。**
 *
 * 以前はどの系統も合計 2.0 に揃えて「総量は同じ、形が違う」としていたが、
 * 実測したら同レベル総当たりで **職人 73% / 学者 25%** だった。原因は
 * 戦闘式のほうにある ── ダメージは atk に二重に効く（威力そのものと、
 * 防御を抜ける割合の両方）ので、**atk 1 点は def 1 点の 2.5 倍の値打ちがある**。
 * 点数を同じだけ配っても、防御に振れた系統は最初から負けている。
 *
 * だから配点を「勝率が 50% に揃う倍率」で解き直した。形（3 つの比）は
 * まったく触っていない ── 学者は変わらず硬く、探索者は変わらず速い。
 * 系統ごとの倍率だけが違い、防御・素早さに寄った系統は総量で少し多く貰う。
 *
 * この結果、系統平均の勝率は 49〜53%、レベルを変えても揺れないところまで来た
 * （Lv8 / Lv20 / Lv60 の総当たりで確認。ブレ幅 49pt → 4〜6pt）。
 *
 * 数字を動かしたら scripts/balance.mjs で測り直すこと。勘で動かさない。
 */
export const STAT_WEIGHTS = {
  artisan: { atk: 0.85, def: 0.53, spd: 0.4 }, // 手を動かす。殴る
  seeker: { atk: 0.61, def: 0.61, spd: 1.0 }, // 調べに行く。速い
  architect: { atk: 0.86, def: 0.72, spd: 0.33 }, // 組み上げる。重い
  scholar: { atk: 0.61, def: 1.05, spd: 0.55 }, // 読んで理解する。硬い
  commander: { atk: 0.71, def: 0.66, spd: 0.52 }, // 任せる。平均的で、召喚で伸びる
};

/** 系統が決まっていないとき（Lv3 未満）の配分。まっさらな見習い。 */
const NEUTRAL = { atk: 0.65, def: 0.7, spd: 0.65 };

/** 系統ベクトルを比率に落とす。1 つも無ければ null（＝見習い扱い）。 */
function shares(classVector) {
  let total = 0;
  for (const id of CLASS_IDS) total += classVector[id] || 0;
  if (total <= 0) return null;
  const out = {};
  for (const id of CLASS_IDS) out[id] = (classVector[id] || 0) / total;
  return out;
}

/**
 * レベルと系統配分からステータスを出す。
 *
 * base はレベルだけで決まる下駄、pool は系統の形で配分が変わるぶん。
 * 「同じレベルなら総量は同じ、形が違う」を保つために、重みの合計を揃えてある。
 */
export function statsFor(level, classVector, multipliers = null) {
  const share = shares(classVector);
  const base = 8 + level * 1.6;
  const pool = 6 + level * 2.4;

  const out = {};
  for (const stat of ['atk', 'def', 'spd']) {
    let weight = 0;
    if (share) {
      for (const id of CLASS_IDS) weight += share[id] * STAT_WEIGHTS[id][stat];
    } else {
      weight = NEUTRAL[stat];
    }
    // 装備は**割合で**乗る（dungeon.js）。固定値だと育つほど誤差になる
    const gear = (multipliers && multipliers[stat]) || 1;
    out[stat] = Math.max(1, Math.round((base * weight + pool * weight) * gear));
  }
  return out;
}

/**
 * 装備の宿りぶんだけ、技の段位を上げる。
 *
 * **生えていない技は生やさない。** 技の出どころは作業ログだけ（DESIGN.md §1）
 * ── 装備で技が生えると、そこが崩れる。宿りが上げるのは、自分で伸ばした技だけ。
 */
function boostSkills(skills, boost) {
  if (!boost) return skills;
  return skills.map((skill) =>
    boost[skill.id] ? { ...skill, tier: Math.min(skill.maxTier, skill.tier + boost[skill.id]) } : skill,
  );
}

/**
 * state から戦闘用のスナップショットを作る。純関数。
 *
 * id は Phase 2 で相手を識別するための値。まだ配布していないので、
 * 手元では seed から作った安定な文字列を入れておく（サーバーが配る番号に
 * 差し替えられるよう、ここでしか作らない）。
 */
export function fighterFrom(state, { lang = 'ja' } = {}) {
  const level = levelForExp(state.exp);
  // 潜った深さぶんの装備。これも導出なので、送る中身は増えない
  const dungeon = dungeonFor(state);
  return {
    // id は言語に依らない（種に入るので、入れ替わると結果が変わる）
    id: `local-${state.seed}`,
    name: nameFor(personaFor(state), state.name, lang),
    level,
    class: state.classId,
    stats: statsFor(level, state.classVector, dungeon.multipliers),
    skills: boostSkills(skillsFor(state), dungeon.skillBoost),
    // 練習相手を「同じくらい育った相手」にするための取り分（bots.js）
    gear: gearWeightOf(dungeon.equipped),
    seed: state.seed,
  };
}
