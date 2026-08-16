import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, applyEvent, totalExpForLevel, MAX_LEVEL, TRAIL_DAYS } from '../src/core/growth.js';
import { CLASS_IDS } from '../src/core/classes.js';
import { fighterFrom, statsFor } from '../src/core/fighter.js';
import { simulate, currentBattle, BATTLE_UNLOCK_LEVEL } from '../src/core/battle.js';
import { matchupFor } from '../src/core/matchup.js';
import { cycleGaps, botFor } from '../src/core/bots.js';
import { viewModel, battleLines } from '../src/core/view.js';
import { boutStartFor, boutHourFor, boutNumberFor } from '../src/core/clock.js';

const T0 = new Date('2026-08-13T12:00:00').getTime();
const DAY = 24 * 60 * 60 * 1000;
/** 一戦の区切り（clock.js の BOUT_HOURS）。 */
const BOUT = 2 * 60 * 60 * 1000;

/** 指定レベル・系統の個体。戦闘の検証に作業ログの再現までは要らない。 */
function fighterState(level, classId = 'artisan', extra = {}) {
  const state = emptyState(T0);
  state.exp = totalExpForLevel(level);
  state.level = level;
  state.classId = level >= 3 ? classId : null;
  state.classVector[classId] = level * 20;
  Object.assign(state.traits, extra);
  return state;
}

test('同じ引数なら何度計算しても同じ結果になる', () => {
  const a = fighterFrom(fighterState(10, 'artisan'));
  const b = fighterFrom(fighterState(10, 'scholar'));
  const first = simulate(a, b, 12345);
  const second = simulate(a, b, 12345);
  assert.deepEqual(first, second);
});

test('種が変われば結果も変わる', () => {
  const a = fighterFrom(fighterState(10, 'artisan'));
  const b = fighterFrom(fighterState(10, 'scholar'));
  const logs = new Set();
  for (let seed = 0; seed < 20; seed += 1) {
    logs.add(JSON.stringify(simulate(a, b, seed).log));
  }
  assert.ok(logs.size > 1, '種を変えても同じログしか出ていない');
});

test('戦闘は Math.random を使わない', () => {
  // 使った瞬間に再現できなくなる。呼ばれたら落とす。
  const original = Math.random;
  Math.random = () => {
    throw new Error('Math.random が呼ばれた');
  };
  try {
    const state = fighterState(12, 'seeker');
    assert.doesNotThrow(() => currentBattle(state, T0));
  } finally {
    Math.random = original;
  }
});

test('戦闘は fighter も state も書き換えない', () => {
  const state = fighterState(12, 'artisan', { comebacks: 40 });
  const stateSnapshot = JSON.stringify(state);
  const you = fighterFrom(state);
  const youSnapshot = JSON.stringify(you);

  simulate(you, fighterFrom(fighterState(12, 'scholar')), 999);
  currentBattle(state, T0);

  assert.equal(JSON.stringify(you), youSnapshot);
  assert.equal(JSON.stringify(state), stateSnapshot);
});

test('必ず決着する（打ち切りでも勝敗が付く）', () => {
  for (let seed = 0; seed < 50; seed += 1) {
    const result = simulate(
      fighterFrom(fighterState(8, 'scholar')),
      fighterFrom(fighterState(8, 'scholar')),
      seed,
    );
    assert.ok(['you', 'foe', 'draw'].includes(result.winner));
    assert.ok(result.turns >= 1 && result.turns <= 24);
  }
});

test('どの系統の組み合わせでも削り合いが長引かない', () => {
  // 防御を引き算にしていた頃、低攻撃 × 高防御が 17 ターン続いて読めなくなった。
  for (const level of [3, 10, 25, 50, 500, MAX_LEVEL]) {
    for (const mine of CLASS_IDS) {
      for (const theirs of CLASS_IDS) {
        const result = simulate(
          fighterFrom(fighterState(level, mine)),
          fighterFrom(fighterState(level, theirs)),
          level * 100,
        );
        assert.ok(
          result.turns <= 12,
          `Lv${level} ${mine} vs ${theirs} が ${result.turns} ターン`,
        );
      }
    }
  }
});

test('同じレベルなら、どの系統でも勝率がだいたい五分', () => {
  // **揃えるのは合計ではなく勝率。** 合計を 2.0 に揃えていた頃、同レベル総当たりで
  // 職人 73% / 学者 25% だった ── ダメージは atk に二重に効くので、
  // 同じ点数を配っても防御に振れた系統は最初から負けている。
  const only = (id) => ({ ...Object.fromEntries(CLASS_IDS.map((c) => [c, 0])), [id]: 1 });
  // 技は外す。ここで見たいのは配点そのものの公平さで、技の強さは別の話。
  const at = (id, level) => ({ ...fighterFrom(fighterState(level, id)), skills: [] });

  for (const level of [8, 30]) {
    const averages = CLASS_IDS.map((a) => {
      let win = 0;
      let n = 0;
      for (const b of CLASS_IDS) {
        for (let seed = 0; seed < 40; seed += 1) {
          n += 1;
          if (simulate(at(a, level), at(b, level), seed * 7 + 1).winner === 'you') win += 1;
        }
      }
      return win / n;
    });
    const min = Math.min(...averages);
    const max = Math.max(...averages);
    const show = CLASS_IDS.map((id, i) => `${id} ${Math.round(averages[i] * 100)}%`).join(' / ');
    assert.ok(min > 0.35 && max < 0.65, `Lv${level} で系統ごとの勝率が偏っている: ${show}`);
  }

  // 形（3 つの比）は系統ごとに違ったまま ── 揃えたのは強さで、性格ではない
  const scholar = statsFor(20, only('scholar'));
  const artisan = statsFor(20, only('artisan'));
  assert.ok(scholar.def > artisan.def, '学者が職人より硬くない');
  assert.ok(artisan.atk > scholar.atk, '職人が学者より殴れていない');
});

test('不屈があると倒れる一撃を 1 度だけ耐える', () => {
  const tough = fighterFrom(fighterState(10, 'scholar', { comebacks: 100 }));
  const plain = fighterFrom(fighterState(10, 'scholar'));
  assert.ok(tough.skills.some((s) => s.id === 'fortitude'));
  assert.ok(!plain.skills.some((s) => s.id === 'fortitude'));

  // 耐えた側は必ずログに残る
  let survived = 0;
  for (let seed = 0; seed < 30; seed += 1) {
    const result = simulate(tough, fighterFrom(fighterState(18, 'artisan')), seed);
    if (result.log.some((e) => e.kind === 'fortitude' && e.side === 'you')) survived += 1;
  }
  assert.ok(survived > 0, '不屈が一度も発動していない');
});

test('弱体は記憶術で振り払える', () => {
  const forgetful = fighterFrom(fighterState(10, 'artisan'));
  const remembers = fighterFrom(fighterState(10, 'artisan', { compacts: 6 }));
  const trickster = { ...fighterFrom(fighterState(10, 'scholar')), quirk: 'weaken' };
  assert.ok(remembers.skills.some((s) => s.id === 'mnemonic'));
  assert.ok(!forgetful.skills.some((s) => s.id === 'mnemonic'));

  let weakened = 0;
  let cleansed = 0;
  for (let seed = 0; seed < 60; seed += 1) {
    const withSkill = simulate(remembers, trickster, seed);
    if (withSkill.log.some((e) => e.kind === 'weaken')) {
      weakened += 1;
      if (withSkill.log.some((e) => e.kind === 'cleanse' && e.side === 'you')) cleansed += 1;
    }
    // 記憶術が無ければ振り払えない
    const without = simulate(forgetful, trickster, seed);
    assert.ok(!without.log.some((e) => e.kind === 'cleanse' && e.side === 'you'));
  }
  assert.ok(weakened > 0, '弱体が一度も飛んでいない');
  assert.equal(cleansed, weakened, '弱体を受けたのに振り払っていない試合がある');
});

test('弱体は攻撃を目に見えて鈍らせる', () => {
  // 手番の頭で残りターンを減らしていた頃、2 ターンのつもりが 1 発しか鈍らなかった。
  //
  // 1 戦の中で「弱体前と弱体後」を比べることはできない。切れた瞬間に相手が
  // 掛け直すので、実際にはほぼ全編が弱体下になる。撒く相手と撒かない相手に
  // 同じ数だけ挑んで、平均で比べる。
  const target = fighterFrom(fighterState(30, 'artisan'));
  const plain = fighterFrom(fighterState(30, 'scholar'));
  const trickster = { ...plain, quirk: 'weaken' };

  const average = (foe) => {
    let sum = 0;
    let n = 0;
    for (let seed = 0; seed < 300; seed += 1) {
      for (const e of simulate(target, foe, seed).log) {
        if (e.side === 'you' && e.kind === 'hit') {
          sum += e.amount;
          n += 1;
        }
      }
    }
    return sum / n;
  };

  const ratio = average(trickster) / average(plain);
  assert.ok(ratio < 0.9, `弱体を撒かれても威力が ${(ratio * 100).toFixed(0)}% しか落ちていない`);
});

test('Lv3 未満では練習試合が始まらない', () => {
  assert.equal(currentBattle(fighterState(1), T0), null);
  assert.equal(currentBattle(fighterState(BATTLE_UNLOCK_LEVEL - 1), T0), null);
  assert.ok(currentBattle(fighterState(BATTLE_UNLOCK_LEVEL), T0));
});

test('相手が練習相手であることが結果に必ず付いている', () => {
  const battle = currentBattle(fighterState(12), T0);
  assert.equal(battle.practice, true);
  assert.equal(battle.opponent.practice, true);
});

test('同じ区切りの中なら同じ相手、次の一戦では変わる', () => {
  // 一戦は 2 時間ごと（clock.js の BOUT_HOURS）。区切りの中では動かない
  const state = fighterState(12);
  const inBout = new Date('2026-08-13T12:00:00').getTime();
  assert.deepEqual(currentBattle(state, inBout), currentBattle(state, inBout + 59 * 60 * 1000));

  const names = new Set();
  for (let b = 0; b < 14; b += 1) names.add(currentBattle(state, T0 + b * BOUT).opponent.name);
  assert.ok(names.size > 1, '毎回同じ相手しか出てこない');
});

test('区切りをまたぐと、次の一戦になっている', () => {
  // 1 日 1 戦だった頃は、昼に一度見たらその日はもう何も起きなかった
  const state = fighterState(12);
  const before = new Date('2026-08-13T13:59:00').getTime();
  const after = new Date('2026-08-13T14:01:00').getTime();
  assert.notEqual(currentBattle(state, before).stamp, currentBattle(state, after).stamp);
  // 2 時間ごとなので、1 日のうちに 12 戦ぶん進む
  const first = currentBattle(state, new Date('2026-08-13T00:00:00').getTime()).stamp;
  const next = currentBattle(state, new Date('2026-08-14T00:00:00').getTime()).stamp;
  assert.equal(next - first, 12);
});

test('夜更かし補正は、実際に未明に働いた人に乗る', () => {
  // 時刻を種から引いていた頃は、昼に見ていても「未明の戦い」が出ていた
  const state = fighterState(12);
  assert.equal(currentBattle(state, new Date('2026-08-13T03:00:00').getTime()).night, true);
  assert.equal(currentBattle(state, new Date('2026-08-13T13:00:00').getTime()).night, false);
});

test('ログの行は全部日本語の文字列になる', () => {
  const battle = currentBattle(fighterState(15, 'commander', { comebacks: 100 }), T0);
  const lines = battleLines(battle);
  assert.ok(lines.length >= 4);
  for (const line of lines) {
    assert.equal(typeof line, 'string');
    assert.ok(line.length > 0);
    assert.ok(!line.includes('undefined'), `未定義が混ざっている: ${line}`);
  }
  // 最後の行は必ず決着
  assert.ok(/勝ち|引き分け/.test(lines[lines.length - 1]));
});

test('viewModel にスキルと今日の一戦が乗る', () => {
  const view = viewModel(fighterState(12, 'seeker', { compacts: 3 }), T0);
  assert.ok(Array.isArray(view.skills));
  assert.ok(view.skills.some((s) => s.id === 'mnemonic'));
  assert.equal(view.battle.practice, true);
  assert.ok(view.battle.lines.length > 0);
  assert.equal(view.battleUnlockLevel, BATTLE_UNLOCK_LEVEL);
  // 生の log は表示側に渡さない（行だけ渡す）
  assert.equal(view.battle.log, undefined);
});

test('相性は一本の輪になっていて、有利不利の数がどこも同じ', () => {
  // 系統は働き方の結果で、選べない。引いた系統によって不利が続く作りにはできない。
  for (const id of CLASS_IDS) {
    const strong = CLASS_IDS.filter((other) => matchupFor(id, other) === 1);
    const weak = CLASS_IDS.filter((other) => matchupFor(id, other) === -1);
    assert.equal(strong.length, 1, `${id} が強く出られる相手が ${strong.length} 種`);
    assert.equal(weak.length, 1, `${id} が苦手な相手が ${weak.length} 種`);
    assert.equal(matchupFor(id, id), 0);
  }
  // 見習い（系統なし）はどちらにも寄らない
  assert.equal(matchupFor(null, 'artisan'), 0);
  assert.equal(matchupFor('artisan', null), 0);
});

test('相性は効くが、ひっくり返せる範囲に収まっている', () => {
  const rate = (edge) => {
    let win = 0;
    let n = 0;
    for (const mine of CLASS_IDS) {
      for (const theirs of CLASS_IDS) {
        if (matchupFor(mine, theirs) !== edge) continue;
        const you = fighterFrom(fighterState(20, mine));
        const foe = fighterFrom(fighterState(20, theirs));
        for (let seed = 0; seed < 200; seed += 1) {
          n += 1;
          if (simulate(you, foe, seed).winner === 'you') win += 1;
        }
      }
    }
    return win / n;
  };

  const good = rate(1);
  const even = rate(0);
  assert.ok(even > 0.4 && even < 0.6, `五分のはずが ${(even * 100).toFixed(0)}%`);
  assert.ok(good > 0.6, `有利が効いていない: ${(good * 100).toFixed(0)}%`);
  // 相性だけで決まってしまうと、その日の引きが勝敗を持っていく
  assert.ok(good < 0.8, `有利が効きすぎ: ${(good * 100).toFixed(0)}%`);
});

test('格上にも、たまに勝てる', () => {
  // 「どこまでやれば勝てるか分からない」は、番狂わせが起こりうることで成立する。
  const gapRate = (gap) => {
    let win = 0;
    let n = 0;
    for (const mine of CLASS_IDS) {
      // 技を持っている実際の個体で測る。素の個体だと番狂わせの目そのものが無い
      const traits = { comebacks: 40, compacts: 5, toolCalls: 500, prompts: 80, nightOwl: 40 };
      const you = fighterFrom(fighterState(20, mine, traits));
      const foe = fighterFrom(fighterState(20 + gap, mine, traits));
      for (let seed = 0; seed < 300; seed += 1) {
        n += 1;
        if (simulate(you, foe, seed).winner === 'you') win += 1;
      }
    }
    return win / n;
  };

  const five = gapRate(5);
  // Lv20 の +5 は「自分の 1/4 ぶん格上」。ここで 1 割は勝てて、しかし 3 割は超えない。
  assert.ok(five > 0.1, `5 レベル上に勝てなさすぎ: ${(five * 100).toFixed(1)}%`);
  assert.ok(five < 0.3, `5 レベル上に勝ちすぎ: ${(five * 100).toFixed(1)}%`);
  // 差が開くほど勝ちにくくなる。ここが平らになると番狂わせではなく運ゲー。
  // 比べるのは離れた差どうし ── 隣どうし（+1 と +2）は誤差の幅で前後する。
  assert.ok(gapRate(0) > gapRate(3) + 0.1, 'レベル差が勝率に効いていない');
  assert.ok(gapRate(3) > gapRate(8) + 0.05, '差が開いても勝率が下がらない');
});

test('相手の強さを表示側に渡さない', () => {
  // 「あと何レベルで勝てる」が計算できると、負けた時点でその日が終わる
  const view = viewModel(fighterState(20, 'artisan'), T0);
  assert.equal(view.battle.opponent.level, undefined);
  assert.ok(view.battle.opponent.name);
  assert.ok(view.battle.impression, '代わりの手応えが無い');
});

test('上限レベルでも数字が壊れない', () => {
  const battle = currentBattle(fighterState(MAX_LEVEL, 'artisan'), T0);
  assert.equal(battle.you.maxHp > 0, true);
  for (const entry of battle.log) {
    if (entry.amount === undefined) continue;
    assert.ok(Number.isFinite(entry.amount) && entry.amount > 0, `ダメージが ${entry.amount}`);
    assert.ok(Number.isSafeInteger(entry.amount));
  }
  assert.ok(['you', 'foe', 'draw'].includes(battle.winner));
});

test('見習いのうちは battle が null で、解禁レベルだけ伝わる', () => {
  const view = viewModel(fighterState(1), T0);
  assert.equal(view.battle, null);
  assert.equal(view.battleUnlockLevel, BATTLE_UNLOCK_LEVEL);
});

test('7 戦のうちに、格下も格上も来る', () => {
  // 毎回ばらばらに引くと、運が悪いと格上ばかりが続く（実測で 13 連敗）。
  // 「負けた次は弱くする」は戦績を持つことになるので、代わりに
  // 7 戦ぶんをまとめて配って、範囲の各区画から 1 戦ずつ取る。
  for (const level of [5, 20, 200]) {
    for (const cycle of [0, 1, 7, 99]) {
      const gaps = cycleGaps(level, cycle * 7919 + 13);
      assert.equal(gaps.length, 7);
      assert.ok(Math.min(...gaps) < 0, `Lv${level} 第${cycle}巡に格下が無い: ${gaps}`);
      assert.ok(Math.max(...gaps) > 0, `Lv${level} 第${cycle}巡に格上が無い: ${gaps}`);
    }
  }
});

test('負け続ける連戦にならない', () => {
  // 眺めるだけの相棒が延々負け続けると、「ブレなければ報われる」の逆になる。
  // **数えるのは連戦のほう。** 2 時間ごとに一戦あるので、ここが連敗の単位になる。
  const state = fighterState(20, 'scholar', { comebacks: 400, compacts: 8, toolCalls: 5000, prompts: 400 });
  let worst = 0;
  let run = 0;
  let win = 0;
  const bouts = 120 * 12;
  for (let b = 0; b < bouts; b += 1) {
    const battle = currentBattle(state, T0 + b * BOUT);
    if (battle.winner === 'you') {
      win += 1;
      run = 0;
    } else {
      run += 1;
      worst = Math.max(worst, run);
    }
  }
  /*
   * **見るのは連敗の「長さ」ではなく「時間」。**
   *
   * 1 日 1 戦だった頃は 8 連敗で 8 日だったが、いまは 2 時間ごとなので
   * 12 連敗でようやく丸 1 日。しかも 4 ヶ月ぶんは 1,440 戦あるので、
   * 五分の勝負でも 11 前後の連敗は普通に出る（サンプルが 12 倍になった）。
   * 短く縛り直すと、乱数ではなく「負けない相手」を作ることになる。
   */
  const worstHours = worst * 2;
  assert.ok(worstHours <= 24, `${worstHours} 時間ぶん負け続けている（${worst} 連敗）`);
  assert.ok(win / bouts > 0.4, `4 ヶ月の勝率が ${Math.round((win / bouts) * 100)}%`);
});

test('同じ区切りなら相手の振れ幅も変わらない（畳み直しで結果が動かない）', () => {
  const state = fighterState(20, 'artisan');
  for (const bout of [0, 1, 2]) {
    const at = T0 + bout * BOUT;
    assert.deepEqual(currentBattle(state, at), currentBattle(state, at + 30 * 60 * 1000));
  }
});

test('ここ 2 週間は、働かなかった日も並ぶ', () => {
  // 記録のある日だけ返すと、休んだ週が「無かったこと」になって詰まって見える。
  const DAY_MS = 24 * 60 * 60 * 1000;
  let state = emptyState(T0 - 20 * DAY_MS);
  // 5 日前と今日だけ働く
  for (const back of [5, 0]) {
    for (let i = 0; i < 30; i += 1) {
      state = applyEvent(state, {
        t: T0 - back * DAY_MS + i * 1000,
        e: 'PostToolUse',
        s: `d${back}`,
        tool: 'Read',
        ok: true,
      });
    }
  }

  const view = viewModel(state, T0);
  assert.equal(view.trail.length, TRAIL_DAYS);
  assert.equal(view.trail.filter((d) => d.exp > 0).length, 2, '働いた日だけが立っていない');
  assert.equal(view.trail[view.trail.length - 1].exp > 0, true, '今日が末尾に来ていない');
  for (const day of view.trail) {
    assert.ok(day.ratio >= 0 && day.ratio <= 1, `${day.day} の高さが ${day.ratio}`);
  }
  // 一番働いた日が 1。上限（1,500）を 1 にすると、使い方が軽い人の画面が全部ぺったんこになる
  assert.equal(Math.max(...view.trail.map((d) => d.ratio)), 1);
});

test('練習相手は、こちらの育ち方に合わせて技を持ってくる', () => {
  /*
   * 前はレベルだけで決めていて、技の伸びが遅い使い方の人ほど一方的に負けた
   * ── 実測で **Lv50 の学者が練習相手に 9%**、Lv100 で 8%。1 日 1 戦の頃は
   * 年に 100 回の話だったが、2 時間ごとになると「いつ見ても負けている」になる。
   */
  const rng = () => 0.5;
  const bare = botFor(50, rng, { skills: [] });
  assert.equal(bare.skills.length, 1, '技を持たない相手に、いきなり 3 つ持たせている');
  assert.equal(bare.skills[0].tier, 1);

  const grown = botFor(50, rng, { skills: [{ id: 'fortitude', tier: 3 }, { id: 'summon', tier: 3 }] });
  assert.equal(grown.skills.length, 2);
  assert.equal(grown.skills[0].tier, 3, 'こちらが ★3 なのに、相手が付いてきていない');

  // 育ち始めには段位の上限が効く（★3 が並ぶと、何をしても結果が変わらない）
  const young = botFor(5, rng, { skills: [{ id: 'fortitude', tier: 3 }] });
  assert.equal(young.skills[0].tier, 1);
});

test('技を伸ばしても、勝ち負けが一方的にならない', () => {
  // ここが崩れると「技を伸ばすと勝てなくなる（相手も伸びるから）」になり、
  // 逆に緩めると「技が揃ったら勝ち続ける」になる。どちらも眺める理由が消える。
  const BOUTS = 400;
  for (const [level, extra] of [
    [20, { comebacks: 300, compacts: 6 }],
    [60, { comebacks: 300, compacts: 6 }],
    [60, { comebacks: 1600, compacts: 25 }],
  ]) {
    const state = fighterState(level, 'scholar', { toolCalls: 5000, prompts: 400, ...extra });
    let win = 0;
    for (let b = 0; b < BOUTS; b += 1) {
      if (currentBattle(state, T0 + b * BOUT).winner === 'you') win += 1;
    }
    const rate = win / BOUTS;
    assert.ok(rate > 0.35 && rate < 0.65, `Lv${level} の勝率が ${Math.round(rate * 100)}%`);
  }
});

test('一戦の始まりは、実時刻に戻せる（ケガが治るのに要る）', () => {
  /*
   * boutNumberFor は通し番号、boutHourFor は壁時計の時 ── どちらも
   * 「何分前の出来事か」は出せない。ケガ（appearance.js）は時間で勝手に治るので、
   * 実時刻が要る。**機械のローカル時刻を直接見ない**（Worker は UTC。CLAUDE.md）。
   */
  const at = new Date('2026-08-13T13:37:42').getTime();
  const start = boutStartFor(at);
  assert.equal(new Date(start).getHours(), 12, '2 時間の区切りの頭になっていない');
  assert.equal(new Date(start).getMinutes(), 0);
  assert.ok(start <= at && at - start < BOUT, '区切りの中に収まっていない');

  // 区切りの中では動かず、またぐと 2 時間ぶん進む
  assert.equal(boutStartFor(at + 10 * 60000), start);
  assert.equal(boutStartFor(at + BOUT) - start, BOUT);

  // オフセットを渡したら、その土地の壁時計で切れる（+9 時間 = 日本）
  const jst = boutStartFor(at, 9 * 60);
  assert.equal(boutHourFor(at, 9 * 60), new Date(jst + 9 * 3600000).getUTCHours());
  assert.equal(boutNumberFor(jst, 9 * 60), boutNumberFor(at, 9 * 60), '区切りの頭が別の一戦になっている');
});

test('view の一戦には、始まった実時刻が付いている', () => {
  const state = fighterState(12);
  const view = viewModel(state, T0);
  assert.equal(typeof view.battle.startedAt, 'number');
  assert.equal(view.battle.startedAt, boutStartFor(T0), 'ケガの起点がズレている');
});
