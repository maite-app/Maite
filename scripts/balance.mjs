#!/usr/bin/env node
/**
 * バランスを測る。**数字を動かしたら、まずこれを通す。**
 *
 *   node scripts/balance.mjs           # 全部
 *   node scripts/balance.mjs classes   # 系統ごとの公平さだけ
 *   node scripts/balance.mjs levels    # レベル差の効き方だけ
 *   node scripts/balance.mjs bots      # 練習相手への勝率だけ
 *   node scripts/balance.mjs skills    # 技ごとの寄与だけ
 *   node scripts/balance.mjs pace      # 何日でどこまで育つか
 *   node scripts/balance.mjs streaks   # 半年ぶん、毎回の勝ち負けと連敗
 *   node scripts/balance.mjs dungeon   # 潜る深さと、拾う装備の伸び方
 *
 * 見たいのは 7 つ。
 *   1. 同じレベルなら、どの系統でも勝率が五分か（形は違っても強さは同じか）
 *   2. レベル差が、どのレベル帯でも同じくらい効いているか
 *   3. 練習相手に勝ちすぎ・負けすぎていないか
 *   4. 1 つの技だけが勝敗を決めていないか
 *   5. 育つ実感が途中で止まっていないか（技と実績の出方）
 *   6. 負け続ける連戦が無いか
 *   7. 潜る深さと装備が、放っておいて伸び続けるか（止まると眺める理由が消える）
 *
 * ここに出る数字は全部、種付き乱数を回した実測。同じ引数なら毎回同じ数字が出る。
 */
import { CLASS_IDS, CLASSES } from '../src/core/classes.js';
import { statsFor } from '../src/core/fighter.js';
import { simulate, dailyBattle } from '../src/core/battle.js';
import { botFor } from '../src/core/bots.js';
import { rngFrom, hashSeed } from '../src/core/rng.js';
import { SKILL_IDS, SKILLS, skillsFor } from '../src/core/skills.js';
import { emptyState, applyEvents, levelForExp } from '../src/core/growth.js';
// 分母は VISIBLE_IDS。ACHIEVEMENT_IDS には job:* の 16 件が入っていて、
// それを分母にすると「まだなっていない職も数える」＝掟に反する数え方になる
import { VISIBLE_IDS } from '../src/core/achievements.js';
import { dungeonFor, floorFor, effortFor, RARITIES, findAt, IMBUES, weightOf, BOSS_EVERY } from '../src/core/dungeon.js';

const only = (id) => Object.fromEntries(CLASS_IDS.map((c) => [c, c === id ? 1 : 0]));

function fighter(classId, level, skills = []) {
  return {
    id: `probe-${classId}`,
    name: classId,
    level,
    class: classId,
    stats: statsFor(level, only(classId)),
    skills,
    seed: level,
  };
}

const pct = (v) => `${Math.round(v * 100)}%`.padStart(5);

/*
 * **線を機械で判定する。**
 *
 * 前は判定文が人間向けの注記でしかなく、閾値を超えても常に exit 0 だった
 * ── CLAUDE.md の「数字を触ったら balance を通す」が、通しても落ちないので
 * 掟として機能していなかった（2026-08-16 の監査で実測）。
 *
 * 線の出どころは CLAUDE.md。**ここの数字を緩めるときは、向こうも直すこと。**
 */
const LINES = {
  classSpread: [0.45, 0.55], // ① 同レベルなら系統ごとの平均勝率
  gapShape: 12,              // ② 同じ差なら、どのレベル帯でも勝率の開きは このpt 以内
  skillGain: 25,             // ③ 技 1 つの寄与（pt・未満）
  grownRate: [0.45, 0.65],   // ④ 実際に育てた個体の勝率
  worstRun: 12,              // ④ 連敗（戦・以下）
};

const FAILURES = [];

function check(line, ok, detail) {
  if (!ok) FAILURES.push(`${line} … ${detail}`);
  console.log(`  ${ok ? '✓' : '🔴'} ${line} … ${detail}`);
}

function rate(a, b, n, tag) {
  let win = 0;
  for (let i = 0; i < n; i += 1) {
    if (simulate(a, b, hashSeed(`${tag}:${i}`)).winner === 'you') win += 1;
  }
  return win / n;
}

function classes(n = 400) {
  console.log('\n── 同レベル総当たり（技なし）───────────────────');
  for (const level of [8, 20, 60]) {
    const rows = {};
    const avg = {};
    for (const a of CLASS_IDS) {
      rows[a] = {};
      let sum = 0;
      for (const b of CLASS_IDS) {
        rows[a][b] = rate(fighter(a, level), fighter(b, level), n, `${a}:${b}`);
        sum += rows[a][b];
      }
      avg[a] = sum / CLASS_IDS.length;
    }
    const vals = Object.values(avg);
    const spread = (Math.max(...vals) - Math.min(...vals)) * 100;
    console.log(`\nLv${level}`);
    console.log('        ' + CLASS_IDS.map((c) => CLASSES[c].ja.padStart(5)).join('') + '   平均');
    for (const a of CLASS_IDS) {
      console.log(CLASSES[a].ja.padEnd(6) + CLASS_IDS.map((b) => pct(rows[a][b])).join('') + pct(avg[a]));
    }
    console.log(`  系統間のブレ幅 ${spread.toFixed(1)}pt ${spread < 12 ? '' : '← 偏っている'}`);
    const lo = Math.min(...CLASS_IDS.map((c) => avg[c]));
    const hi = Math.max(...CLASS_IDS.map((c) => avg[c]));
    const worstId = CLASS_IDS.find((c) => avg[c] === lo || avg[c] === hi);
    check(
      `① Lv${level} 系統平均 ${Math.round(LINES.classSpread[0] * 100)}〜${Math.round(LINES.classSpread[1] * 100)}%`,
      lo >= LINES.classSpread[0] && hi <= LINES.classSpread[1],
      `${Math.round(lo * 100)}〜${Math.round(hi * 100)}%（外れているのは ${CLASSES[worstId].ja}）`,
    );
  }
}

function levels(n = 400) {
  // 差は割合で見る。ステータスはレベルに比例して伸びるので、「+5」の重みは
  // Lv20 と Lv100 で別物 ── 段数で並べると、高いところが全部同じ数字になる。
  const gaps = [-0.2, -0.1, 0, 0.1, 0.2, 0.3, 0.5];
  console.log('\n── レベル差の効き方（同系統どうし・技なし）─────────');
  console.log('   差:' + gaps.map((g) => `${g > 0 ? '+' : ''}${Math.round(g * 100)}%`.padStart(6)).join(''));
  /*
   * **同じ対戦を 2 回並べない。** 相手のレベルは `round(level * (1 + gap))` で
   * 出すので、レベルが低いと丸めが効いて別々の列が同じ相手になる ── Lv5 では
   * 7 列のうち実質 5 種類しかなく、`-10%` と `0%` が同じ Lv5 戦、`+10%` と
   * `+20%` が同じ Lv6 戦だった。そこで出た 47% と 51% の差は、レベル差の
   * 効き方ではなく**同じ対戦を別の種で回しただけの差**で、これを表に並べると
   * 「Lv5 だけ形が違う」という読み違いを生む（2026-08-16 の監査で実測）。
   *
   * 潰れた列は数字を出さずに `──` を置く。**測れていないことを見せるほうが、
   * 測れたふりをするより役に立つ。**
   */
  const measured = [];
  for (const level of [5, 10, 20, 50, 100]) {
    const cells = gaps.map((gap) => {
      const foe = Math.max(1, Math.round(level * (1 + gap)));
      // **頼んだ差と、実際に測っている差が同じときだけ測る。**
      // 重複を外すだけでは足りない ── Lv5 の `-10%` は 4.5 が 5 に丸まって
      // 「Lv5 対 Lv5」になり、名前は -10% のまま中身は 0% だった。
      // 刻みの半分（0.05）より外れたら、その列は測れていない。
      if (Math.abs(foe / level - 1 - gap) > 0.05) return null;
      return rate(fighter('commander', level), fighter('commander', foe), n, `L${level}g${gap}`);
    });
    measured.push({ level, cells });
    console.log(`Lv${String(level).padStart(3)}: ${cells.map((v) => (v === null ? '  ──  ' : pct(v))).join(' ')}`);
  }
  console.log('  ── は、丸めで頼んだ差にならなかった列（測っていない）');

  /*
   * ② の合格条件。「似た形」では誰も判定できないので、**同じ差の列を縦に見て、
   * レベル帯ごとの勝率の開きが何 pt までか**で決める。閾値は実測から置いた
   * （N=400・p=0.5 の標準誤差が約 2.5pt なので、±2σ の 10pt では狭すぎる）。
   */
  gaps.forEach((gap, i) => {
    const col = measured.map((r) => r.cells[i]).filter((v) => v !== null);
    if (col.length < 2) return; // 1 行しか測れていない列は判定しない
    const spread = (Math.max(...col) - Math.min(...col)) * 100;
    check(
      `② 差 ${gap > 0 ? '+' : ''}${Math.round(gap * 100)}% の縦の開き ${LINES.gapShape}pt 以内`,
      spread <= LINES.gapShape,
      `${spread.toFixed(1)}pt（${col.length} 行）`,
    );
  });
}

function botRates(level, skills, n = 600, night = false) {
  let win = 0;
  for (let i = 0; i < n; i += 1) {
    // 練習相手はこちらの育ち方に合わせて技を持ってくる（bots.js の loadoutFor）。
    // 渡し忘れると「技を持たない相手」を測ることになり、数字が丸ごと甘くなる。
    const foe = botFor(level, rngFrom(hashSeed(`day:${level}:${i}`)), { skills });
    const you = fighter('scholar', level, skills);
    if (simulate(you, foe, hashSeed(`b:${level}:${i}`), { night }).winner === 'you') win += 1;
  }
  return win / n;
}

function bots() {
  // ここは**下限**。技を 1 つも持たない Lv50 は現実にはいない
  // （実際の毎日の勝ち負けは `balance.mjs streaks` のほう）。
  console.log('\n── 練習相手への勝率（学者・技なし＝下限）────────');
  for (const level of [5, 10, 20, 50, 100]) {
    console.log(`  Lv${String(level).padStart(3)}: ${pct(botRates(level, []))}`);
  }
  console.log('\n── 技が育っていく途中（Lv20）──────────────────');
  const growing = [
    ['技なし', []],
    ['★1 が 1 つ', [{ id: 'fortitude', tier: 1 }]],
    ['★2 が 2 つ', [{ id: 'fortitude', tier: 2 }, { id: 'summon', tier: 2 }]],
    ['★3 が 3 つ', [
      { id: 'fortitude', tier: 3 },
      { id: 'summon', tier: 3 },
      { id: 'foresight', tier: 3 },
    ]],
  ];
  for (const [label, skills] of growing) console.log(`  ${label.padEnd(12)}: ${pct(botRates(20, skills))}`);
}

function skills() {
  console.log('\n── 技ごとの寄与（Lv20・練習相手・その技だけ持つ）───');
  // 夜目は夜の戦いにしか乗らない。昼で測ると必ず 0pt になるので、
  // その技が効く場面で測る（夜になるのは 24 日に 5 日ぶんの割合）。
  const night = (id) => id === 'nightVision';
  for (const id of SKILL_IDS) {
    const base = botRates(20, [], 600, night(id));
    let best = -Infinity;
    const cells = [1, 2, 3].map((tier) => {
      const got = botRates(20, [{ id, tier }], 600, night(id));
      const diff = Math.round((got - base) * 100);
      best = Math.max(best, diff);
      return `★${tier} ${pct(got)}(${diff >= 0 ? '+' : ''}${diff}pt)`;
    });
    console.log(`  ${SKILLS[id].ja.padEnd(4)}${night(id) ? '(夜)' : '    '} ${cells.join('  ')}`);
    check(
      `③ ${SKILLS[id].ja} の寄与 +${LINES.skillGain}pt 未満`,
      best < LINES.skillGain,
      `最大 +${best}pt`,
    );
  }
  console.log('  1 つで +25pt を超える技があるなら、それだけが勝敗を決めている');
}

/* ───────────────── 実際に育てた個体で測る ───────────────── */

const DAY = 24 * 60 * 60 * 1000;
const START = Date.parse('2026-01-05T09:00:00Z'); // 月曜の朝から

/**
 * 1 日ぶんの作業ログを捏造する。**手作りの個体では高レベルが不当に弱く出る**
 * ── Lv60 の人が立て直し 30 回のままということは無い。
 *
 * 実測に寄せた比率：ツール呼び出し 250 回／日、その 9% が失敗してその場で直る、
 * 3% が Task、調べものが 6%、compact が 2 日に 1 回、夜まで及ぶのが 8%。
 */
function dayOfWork(state, dayIndex, rng, classId) {
  const events = [];
  const at = START + dayIndex * DAY;
  const session = `s${dayIndex}`;
  const main = { scholar: 'Read', artisan: 'Bash', architect: 'Edit', seeker: 'WebSearch', commander: 'Task' }[classId];

  events.push({ t: at, e: 'SessionStart', s: session });
  events.push({ t: at + 1000, e: 'UserPromptSubmit', s: session });
  let clock = at + 2000;
  for (let i = 0; i < 250; i += 1) {
    // 夜まで及ぶ日は、途中から 0〜5 時の時間帯に入る
    clock += rng() < 0.08 ? 90_000 : 25_000;
    const roll = rng();
    const tool = roll < 0.03 ? 'Task' : roll < 0.09 ? 'WebSearch' : roll < 0.2 ? 'Grep' : main;
    if (rng() < 0.09) {
      events.push({ t: clock, e: 'PostToolUse', s: session, tool, ok: false });
      events.push({ t: clock + 30_000, e: 'PostToolUse', s: session, tool, ok: true });
    } else {
      events.push({ t: clock, e: 'PostToolUse', s: session, tool, ok: true });
    }
    if (i % 50 === 49) events.push({ t: clock + 1000, e: 'UserPromptSubmit', s: session });
  }
  if (rng() < 0.5) events.push({ t: clock + 2000, e: 'PreCompact', s: session });
  events.push({ t: clock + 3000, e: 'SessionEnd', s: session });
  return applyEvents(state, events);
}

/** 目標レベルまで育てる。返すのは state と、かかった日数。 */
function grown(level, classId = 'scholar') {
  const rng = rngFrom(hashSeed(`grow:${classId}`));
  let state = emptyState(START);
  let day = 0;
  while (levelForExp(state.exp) < level && day < 4000) {
    state = dayOfWork(state, day, rng, classId);
    day += 1;
  }
  return { state, days: day };
}

function pace() {
  console.log('\n── 実際に働いて何日で届くか（1 日 250 ツール・学者）───');
  const rng = rngFrom(hashSeed('grow:scholar'));
  let state = emptyState(START);
  const marks = [3, 10, 30, 50, 100];
  let next = 0;
  for (let day = 0; day < 1200 && next < marks.length; day += 1) {
    state = dayOfWork(state, day, rng, 'scholar');
    while (next < marks.length && levelForExp(state.exp) >= marks[next]) {
      const skills = skillsFor(state).map((s) => `${s.ja}★${s.tier}`).join(' ') || '技なし';
      const badges = Object.keys(state.achievements).length;
      console.log(
        `  Lv${String(marks[next]).padStart(3)}  ${String(day + 1).padStart(4)} 日目  実績 ${String(badges).padStart(2)}/${VISIBLE_IDS.length}  ${skills}`,
      );
      next += 1;
    }
  }
  console.log('  実績が最初の 2 週間で出尽くすなら、長い尻尾が足りていない');
}

function streaks() {
  // **数えるのは連戦のほう。** 一戦は 2 時間ごとなので、半年で 2,160 戦ある
  console.log('\n── 半年ぶん、2 時間ごとの一戦（実際に育てた個体）─────');
  const BOUT = 2 * 60 * 60 * 1000;
  const bouts = 180 * 12;
  for (const level of [5, 10, 30, 60]) {
    const { state } = grown(level);
    let win = 0;
    let worst = 0;
    let run = 0;
    for (let b = 0; b < bouts; b += 1) {
      const battle = dailyBattle(state, START + b * BOUT);
      if (battle.winner === 'you') {
        win += 1;
        run = 0;
      } else {
        run += 1;
        worst = Math.max(worst, run);
      }
    }
    console.log(
      `  Lv${String(level).padStart(3)}: 勝率 ${pct(win / bouts)}  最長の連敗 ${String(worst).padStart(2)} 戦（${worst * 2} 時間ぶん）`,
    );
    const r = win / bouts;
    check(
      `④ Lv${level} の勝率 ${Math.round(LINES.grownRate[0] * 100)}〜${Math.round(LINES.grownRate[1] * 100)}%`,
      r >= LINES.grownRate[0] && r <= LINES.grownRate[1],
      `${Math.round(r * 100)}%`,
    );
    check(`④ Lv${level} の連敗 ${LINES.worstRun} 戦以下`, worst <= LINES.worstRun, `${worst} 戦`);
  }
  console.log('  眺めるだけの相棒が丸一日負け続けると、「ブレなければ報われる」の逆になる');
}

function dungeon() {
  // 深さは作業量から出る（dungeon.js）。**止まらずに伸び続けるか**を見る
  console.log('\n── 働いた量と、潜れる深さ ──────────────────────');
  const rng = rngFrom(hashSeed('dig:scholar'));
  let state = emptyState(START);
  const marks = [1, 3, 7, 14, 30, 90, 180, 365];
  let next = 0;
  for (let day = 0; day < 366 && next < marks.length; day += 1) {
    state = dayOfWork(state, day, rng, 'scholar');
    if (day + 1 !== marks[next]) continue;
    const d = dungeonFor(state);
    const gear = ['atk', 'def', 'spd']
      .map((slot) => (d.equipped[slot] ? `${slot} +${Math.round(d.equipped[slot].bonus * 100)}%` : `${slot} ─`))
      .join('  ');
    console.log(
      `  ${String(marks[next]).padStart(3)} 日目  作業量 ${String(effortFor(state)).padStart(7)}  地下 ${String(d.floor).padStart(3)} 階  主 ${String(d.bosses.length).padStart(2)} 体   ${gear}`,
    );
    next += 1;
  }
  console.log(`  主は ${BOSS_EVERY} 階ごと。途中で深さが止まると、拾うものも主も止まる`);

  console.log('\n── 深さごとの、拾い物の位 ─────────────────────');
  const head = RARITIES.map((r) => r.ja.padStart(4)).join(' ');
  console.log(`        ${head}`);
  for (const floor of [1, 10, 40, 100, 300, 900]) {
    const count = Object.fromEntries(RARITIES.map((r) => [r.id, 0]));
    const n = 4000;
    for (let seed = 0; seed < n; seed += 1) count[findAt(seed, floor).rarity] += 1;
    const row = RARITIES.map((r) => pct(count[r.id] / n).padStart(4)).join(' ');
    console.log(`  ${String(floor).padStart(4)} 階 ${row}`);
  }
  console.log('  最上位が深いところでも珍しいままなら、拾った時の値打ちが残っている');

  console.log('\n── 宿りの乗り方 ───────────────────────────────');
  console.log('          無し   1 つ   2 つ');
  for (const floor of [1, 10, 40, 100, 300, 900]) {
    const count = [0, 0, 0];
    const n = 3000;
    for (let seed = 0; seed < n; seed += 1) count[findAt(seed, floor).imbues.length] += 1;
    console.log(`  ${String(floor).padStart(4)} 階 ${count.map((c) => pct(c / n).padStart(5)).join(' ')}`);
  }
  console.log(`  宿りは ${IMBUES.length} 種。全部に乗るなら「あるのが普通」になって値打ちが消える`);

  // **同じ装備でも中身で形が変わる**か。ここが平らなら、宿りは名前だけの飾り
  console.log('\n── 同じ〈攻 +10%〉でも、宿りで形が変わる ─────────');
  for (const imbue of IMBUES.filter((i) => i.spread)) {
    const w = weightOf({ slot: 'atk', bonus: 0.1, imbues: [imbue.id] });
    const row = ['atk', 'def', 'spd'].map((k) => `${k} +${Math.round(w[k] * 100)}%`).join('  ');
    console.log(`  ${imbue.ja.padEnd(7)} ${row}`);
  }
  for (const imbue of IMBUES.filter((i) => i.skill)) {
    console.log(`  ${imbue.ja.padEnd(7)} ${imbue.skill} を 1 段`);
  }
}

const what = process.argv[2];
if (!what || what === 'classes') classes();
if (!what || what === 'levels') levels();
if (!what || what === 'bots') bots();
if (!what || what === 'skills') skills();
if (!what || what === 'pace') pace();
if (!what || what === 'streaks') streaks();
if (!what || what === 'dungeon') dungeon();

/*
 * **落ちる。** 線を外していたら exit 1 にする ── そうでないと
 * 「balance を通した」が何の証拠にもならない。
 */
if (FAILURES.length) {
  console.log(`\n🔴 線を ${FAILURES.length} 本外している\n`);
  for (const f of FAILURES) console.log(`  ${f}`);
  console.log('\n  線の出どころは CLAUDE.md。数字を動かすか、線を実測に合わせるかは人が決める。\n');
  process.exit(1);
}
console.log('\n✓ 線は全部内側\n');
