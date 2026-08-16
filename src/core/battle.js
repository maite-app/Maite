/**
 * オートバトル。
 *
 * **操作は無い**（DESIGN.md §5）。開くと今日の 1 戦がもう終わっていて、
 * ログを眺めるだけ。ユーザーに手番を渡した瞬間、「普段どおり仕事をするだけでいい」
 * が壊れる。
 *
 * **結果を保存しない。** 種が (自分 ID + 相手 ID + 日付) で決まるので、
 * 何度計算しても同じ結果になる。保存しないから state に戦績フィールドが増えず、
 * STATE_VERSION を上げずに済む。Phase 2 で相手のスナップショットを 1 体
 * 落としてきてクライアント側で解決するのも、まったく同じ仕組みで動く。
 */
import { levelForExp } from './growth.js';
import { fighterFrom } from './fighter.js';
import { tierOf, SKILL_POWER } from './skills.js';
import { botFor } from './bots.js';
import { rngFrom, hashSeed, intBetween } from './rng.js';
import { matchupFor, matchupText, ADVANTAGE_ATK, DISADVANTAGE_DEF } from './matchup.js';
import { dayStampFor, boutNumberFor, boutHourFor, BOUT_HOURS } from './clock.js';

/** 決着が付かないまま延々続くより、判定に落としたほうがログが読める。 */
const MAX_TURNS = 24;

/** 系統が決まる前に戦わせない。見習いのうちは育つところだけ見せる。 */
export const BATTLE_UNLOCK_LEVEL = 3;

/**
 * 不屈が倒れる一撃を止められる確率（段位 1..3）。**止められるのは 1 戦に 1 度だけ。**
 *
 * ★3 で 2 度耐えられるようにしていたら、その技だけで勝率が 38pt 動いた
 * ── 1 つの技で勝敗が決まると、他の技が誤差になる。段位で上げるのは
 * 回数ではなく確率のほうにした（8pt / 13pt / 19pt）。
 */
const FORTITUDE_CHANCE = SKILL_POWER.fortitude.chance;

/** 弱体が乗っている間の攻撃力。 */
const WEAKEN_FACTOR = 0.7;
const WEAKEN_TURNS = 2;

/**
 * 会心の一撃。
 *
 * **格下ほど出やすい。** 格上に当たったときに「何をどれだけ積めば勝てるか」が
 * 計算で出てしまうと、負けた時点でその日の戦いは終わってしまう。番狂わせが
 * 起こりうると分かっていれば、格上でも最後まで見る意味が残る。
 *
 * 逆に格上側は基礎値のまま。強い側が更に有利になる補正は入れない。
 */
const CRIT_BASE = 0.06;
const CRIT_MAX = 0.32;
const CRIT_MULT = 2.2;
/** レベル差ぶんの上乗せ。差は「相対」で見る（下の relativeGap）。 */
const CRIT_GAP_CHANCE = 1.2;
const CRIT_GAP_MULT = 2.5;

/**
 * 番狂わせ補正。格下側の攻守に、レベル差ぶんだけ掛かる。
 *
 * 会心だけでは足りなかった。攻撃力も HP も両方レベルで伸びるので、差が
 * 掛け算で効いて **5 レベル上に勝てるのが 1.9%** になっていた ── これでは
 * 「たまに勝つ」ではなく「絶対に勝てない」で、格上に当たった日が消える。
 *
 * 逆に格上側には何も足さない。強い側がさらに強くなる補正は入れない。
 */
// **差は「何段違うか」ではなく「いまの自分に対してどれだけ大きいか」で見る。**
// ステータスは level に比例して伸びるので、+5 の重みは Lv20 と Lv60 で別物になる
// ── 段数で補正していた頃、Lv20 では +8 に勝率 0%、Lv50 では +8 に 78% で、
// **育つほどレベル差が意味を失っていた**（しまいには格上のほうが勝てなくなる）。
//
// 埋めるのは差の一部だけ（K = 0.8 で、比の 8 割ぶんを攻守に乗せる）。全部埋めると
// 差そのものが消えて運ゲーになる。分母に足す 6 は、Lv1〜3 で分母が小さすぎて
// 補正が跳ねるのを抑えるための下駄。
const UNDERDOG_K = 0.8;
const UNDERDOG_SOFT = 6;

/**
 * 差の頭打ち。ここから先はどれだけ格上でも補正は変わらない。
 * 段数ではなく比で打ち止めるので、Lv5 の +8 も Lv100 の +40 も同じ扱いになる。
 */
const RELGAP_MAX = 0.35;

/** 素早さ差での連撃の出やすさ。傾斜で効かせる（段差を作らない）。 */
const SWIFT_SLOPE = 0.9;
const SWIFT_MAX = 0.45;

/** その日の識別子。growth.js の日次キャップと同じ切り方に揃える。 */
export function dayStamp(ts, tzOffset = null) {
  return dayStampFor(ts, tzOffset);
}

/** その一戦の識別子。2 時間ごとに変わる（clock.js の BOUT_HOURS）。 */
export function boutStamp(ts, tzOffset = null) {
  return boutNumberFor(ts, tzOffset);
}

/**
 * HP はレベルだけで決まる。def を足さないのは二重取りを避けるため
 * ── 防御は下のダメージ計算で割合として効いている。
 */
export function hpFor(fighter) {
  return Math.round(40 + fighter.level * 8);
}

/** 戦闘中だけ持つ可変の状態。fighter 自体は書き換えない（純関数のため）。 */
function sideFrom(fighter, night, matchup = 0) {
  const skills = fighter.skills || [];
  const nightTier = tierOf(skills, 'nightVision');
  const nightBonus = night ? 1 + nightTier * SKILL_POWER.nightVision.perTier : 1;
  // 相性は攻撃のバフと守りのデバフで表す（DESIGN.md §5d）
  const atkBuff = matchup === 1 ? ADVANTAGE_ATK : 1;
  const defDebuff = matchup === -1 ? DISADVANTAGE_DEF : 1;
  return {
    fighter,
    name: fighter.name,
    level: fighter.level,
    hp: hpFor(fighter),
    maxHp: hpFor(fighter),
    atk: fighter.stats.atk * nightBonus * atkBuff,
    def: fighter.stats.def * defDebuff,
    // 先読みは**割合**で乗せる。+3 の固定値だと Lv20 では素早さ +6% でも
    // Lv100 では +1% になり、育つほど技が消えていく。
    spd: fighter.stats.spd * nightBonus * (1 + tierOf(skills, 'foresight') * SKILL_POWER.foresight.perTier),
    // 不屈は「何回耐えられるか」ではなく「耐えられるか」を段位で上げる。
    // ★1 でいきなり確実に 1 回耐えていた頃、技 1 つで勝率が 15pt 動いていた
    // ── 最初に生える技がそれだと、後から生える技が誤差になる。
    fortitudeLeft: tierOf(skills, 'fortitude') > 0 ? 1 : 0,
    fortitudeChance: FORTITUDE_CHANCE[tierOf(skills, 'fortitude')] || 0,
    summon: tierOf(skills, 'summon'),
    mnemonic: tierOf(skills, 'mnemonic'),
    nightAwake: night && nightTier > 0,
    quirk: fighter.quirk || null,
    weakenLeft: 0,
    critUsed: false,
  };
}

/**
 * 防御は引き算ではなく割合で効かせる。
 *
 * 引き算にすると、atk も def もレベルで伸びるせいで、高レベルの
 * 「低攻撃 × 高防御」がほぼ 0 ダメージになる。割合なら、どのレベルでも
 * どの組み合わせでも 5〜10 発ぶんに収まる。
 */
function damage(attacker, defender, rng) {
  const weakened = attacker.weakenLeft > 0 ? WEAKEN_FACTOR : 1;
  const jitter = 0.65 + rng() * 0.7;
  const power = attacker.atk * weakened;
  const through = (1.6 * power) / (defender.def + 1.6 * power);
  return Math.max(1, Math.round(power * through * jitter));
}

/** 与えたダメージを反映する。倒れる一撃は「不屈」が段位ぶんの確率で止める。 */
function strike(attacker, defender, amount, log, turn, side, kind, rng) {
  let survived = false;
  defender.hp -= amount;
  if (defender.hp <= 0 && defender.fortitudeLeft > 0) {
    defender.fortitudeLeft -= 1;
    if (rng() < defender.fortitudeChance) {
      defender.hp = 1;
      survived = true;
    }
  }
  log.push({ turn, side, kind, amount, hp: Math.max(0, defender.hp) });
  if (survived) {
    log.push({ turn, side: side === 'you' ? 'foe' : 'you', kind: 'fortitude', hp: 1 });
  }
}

function act(attacker, defender, rng, log, turn, side) {
  // 記憶術は自分の手番の頭で振り払う。段位ぶんだけ使える。
  if (attacker.weakenLeft > 0 && attacker.mnemonic > 0) {
    attacker.weakenLeft = 0;
    attacker.mnemonic -= 1;
    log.push({ turn, side, kind: 'cleanse' });
  }

  // 会心。格下ほど出やすく、**格下ほど重い**。
  // **1 戦に 1 度だけ。** 一発逆転が何度も起きると、それはもう逆転ではなく運ゲー。
  //
  // 威力のほうにも差を効かせているのは、確率だけでは足りなかったから。
  // 会心が 2.2 倍固定だと、8 発のうち 1 発が少し重いだけで、総ダメージは 15% しか
  // 増えない ── ステータス差 24% はそれでは覆らず、**格上に勝てるのが 1〜2%** だった。
  // 一撃で HP の半分を持っていける重さにして初めて「番狂わせ」が起きる。
  const relGap = relativeGap(attacker.level, defender.level);
  const critChance = Math.min(CRIT_MAX, CRIT_BASE + relGap * CRIT_GAP_CHANCE);
  const crit = !attacker.critUsed && rng() < critChance;
  if (crit) attacker.critUsed = true;
  const base = damage(attacker, defender, rng);
  strike(
    attacker,
    defender,
    crit ? Math.round(base * (CRIT_MULT + relGap * CRIT_GAP_MULT)) : base,
    log,
    turn,
    side,
    crit ? 'crit' : 'hit',
    rng,
  );
  if (defender.hp <= 0) return;

  // 素早さ差での連撃。spd が「どちらが先に殴るか」にしか効かないと、
  // 速さに振れた系統（探索者）だけステータスの払い損になる。
  //
  // **しきい値ではなく傾斜で効かせる。** 「1.3 倍を超えたら 35%」にしていた頃、
  // 素早さ比がちょうど 1.3 のあたりに乗る組み合わせ（統率者 対 職人）が、
  // レベルの丸め次第で 88% と 64% を行き来していた。段差の上に乗るかどうかで
  // 勝率が 24pt 変わるのは、育ちが結果に効いているとは言えない。
  const swift = Math.min(SWIFT_MAX, Math.max(0, (attacker.spd / defender.spd - 1.05) * SWIFT_SLOPE));
  if (swift > 0 && rng() < swift) {
    const extra = Math.max(1, Math.round(damage(attacker, defender, rng) * 0.6));
    strike(attacker, defender, extra, log, turn, side, 'swift', rng);
    if (defender.hp <= 0) return;
  }

  // 召喚：分身が追撃する。段位ぶんだけ出やすく、威力は本体の半分。
  if (attacker.summon > 0 && rng() < SKILL_POWER.summon.perTier * attacker.summon) {
    const extra = Math.max(1, Math.round(damage(attacker, defender, rng) * 0.5));
    strike(attacker, defender, extra, log, turn, side, 'summon', rng);
    if (defender.hp <= 0) return;
  }

  // 弱体を撒く相手（練習相手の癖）。既に乗っているときは重ねない。
  if (attacker.quirk === 'weaken' && defender.weakenLeft === 0 && rng() < 0.3) {
    defender.weakenLeft = WEAKEN_TURNS;
    log.push({ turn, side, kind: 'weaken' });
  }

  // 減らすのは殴った後。手番の頭で減らすと、WEAKEN_TURNS を 2 にしても
  // 実際に鈍るのは 1 発だけになる。
  if (attacker.weakenLeft > 0) attacker.weakenLeft -= 1;
}

/**
 * 2 体を戦わせる。同じ引数なら必ず同じ結果になる。
 *
 * 先攻は素早さ。同値なら種で決める（レベルで決めると、低レベル側が
 * 永久に後攻になって「先読み」の意味が消える）。
 */
/**
 * 「自分から見て、相手がどれだけ大きいか」。0 なら同格以下。
 * ステータスは level に比例して伸びるので、差は段数ではなく比で見る。
 */
function relativeGap(mine, theirs) {
  const gap = Math.max(0, theirs - mine);
  return Math.min(RELGAP_MAX, gap / (mine + UNDERDOG_SOFT));
}

function applyUnderdog(side, gap) {
  if (gap <= 0) return;
  const ratio = relativeGap(side.level, side.level + gap);
  const boost = 1 + ratio * UNDERDOG_K;
  side.atk *= boost;
  side.def *= boost;
}

export function simulate(you, foe, seed, { night = false } = {}) {
  const rng = rngFrom(seed);
  const edge = matchupFor(you.class, foe.class);
  const a = sideFrom(you, night, edge);
  const b = sideFrom(foe, night, -edge);
  const log = [];

  if (edge !== 0) {
    const winner = edge === 1 ? you.class : foe.class;
    const loser = edge === 1 ? foe.class : you.class;
    log.push({
      turn: 0,
      side: edge === 1 ? 'you' : 'foe',
      kind: 'matchup',
      text: matchupText(winner, loser),
    });
  }

  // 番狂わせ補正は格下側だけに掛ける
  applyUnderdog(a, b.level - a.level);
  applyUnderdog(b, a.level - b.level);

  const youFirst = a.spd === b.spd ? rng() < 0.5 : a.spd > b.spd;
  log.push({ turn: 0, side: youFirst ? 'you' : 'foe', kind: 'first' });
  if (a.nightAwake || b.nightAwake) {
    log.push({ turn: 0, side: a.nightAwake ? 'you' : 'foe', kind: 'night' });
  }

  let turn = 1;
  for (; turn <= MAX_TURNS; turn += 1) {
    const order = youFirst ? [['you', a, b], ['foe', b, a]] : [['foe', b, a], ['you', a, b]];
    for (const [side, attacker, defender] of order) {
      if (a.hp <= 0 || b.hp <= 0) break;
      act(attacker, defender, rng, log, turn, side);
    }
    if (a.hp <= 0 || b.hp <= 0) break;
  }

  let winner;
  if (a.hp <= 0 && b.hp <= 0) winner = 'draw';
  else if (b.hp <= 0) winner = 'you';
  else if (a.hp <= 0) winner = 'foe';
  else {
    // 時間切れ。残 HP の割合で判定する（最大値が違うので実数で比べる）
    const ra = a.hp / a.maxHp;
    const rb = b.hp / b.maxHp;
    winner = ra === rb ? 'draw' : ra > rb ? 'you' : 'foe';
    log.push({ turn, side: 'you', kind: 'timeup' });
  }

  log.push({ turn, side: winner === 'foe' ? 'foe' : 'you', kind: 'end' });

  return {
    winner,
    turns: Math.min(turn, MAX_TURNS),
    you: { name: a.name, hp: Math.max(0, a.hp), maxHp: a.maxHp },
    foe: { name: b.name, hp: Math.max(0, b.hp), maxHp: b.maxHp },
    log,
  };
}

/**
 * 直近の 1 戦。state から導出するだけで、どこにも書き込まない。
 *
 * 種は「自分の ID + 相手 + 一戦の通し番号」。**2 時間ごとに変わる**
 * （clock.js の BOUT_HOURS）── 1 日 1 戦だった頃は、昼に一度見たら
 * その日はもう何も起きなかった。席に戻るたびに一戦ぶん進んでいるほうが、
 * 眺めるものとしては正しい。
 *
 * 戦った時刻は**その一戦の頭の時刻**（0, 2, 4 …）。乱数で引いていた頃の
 * 「見るたびに時刻が変わる」は、区切りが 2 時間になった時点で解消している
 * ── 区切りの中では動かないし、夜更かし補正も実際に未明に働いた人に乗る。
 *
 * ただし**自分が育てば直近の一戦も変わる**。state が変われば結果も変わるのは
 * 導出である以上避けられないし、「いまの自分で戦ったらどうなるか」が出るのは
 * むしろ正しい。固定したければ結果を保存することになり、そのぶん state に
 * 戦績が増える ── Phase 1 では取らない。
 */
export function currentBattle(state, now = Date.now(), { tzOffset = null, lang = 'ja' } = {}) {
  const level = levelForExp(state.exp);
  if (level < BATTLE_UNLOCK_LEVEL) return null;

  const stamp = boutStamp(now, tzOffset);
  // lang は名前の見え方だけ。種に入るのは id なので、結果は言語で変わらない
  const you = fighterFrom(state, { lang });

  const boutRng = rngFrom(hashSeed(`${you.id}:${stamp}`));
  // レベル差だけは 7 戦ぶんまとめて配られる（bots.js の cycleGaps）。
  // 顔ぶれはこの一戦の種のまま。
  const foe = botFor(level, boutRng, {
    slotNumber: stamp,
    cycleSeed: you.id,
    lang,
    // 練習相手は「いまの自分と同じくらい育った相手」。勝敗を決めるのは
    // レベルの振れ幅だけにして、技や装備の伸び方で一方的にならないようにする
    skills: you.skills,
    gear: you.gear,
  });
  const hour = boutHourFor(now, tzOffset);
  const night = hour < 5;

  const seed = hashSeed(`${you.id}:${foe.id}:${stamp}`);
  const result = simulate(you, foe, seed, { night });
  return { ...result, practice: Boolean(foe.practice), stamp, hour, night, boutHours: BOUT_HOURS, opponent: foe };
}

/**
 * 前の名前のまま呼ばれても動くようにしておく（scripts / テスト）。
 * 中身は 2 時間ごとの一戦。
 */
export const dailyBattle = currentBattle;
