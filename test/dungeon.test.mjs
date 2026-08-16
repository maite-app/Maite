import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, applyEvent, totalExpForLevel } from '../src/core/growth.js';
import {
  BOSSES,
  BOSS_EVERY,
  bossAt,
  bossesUpTo,
  IMBUES,
  weightOf,
  skillBoostOf,
  skillBoostsOf,
  effortFor,
  floorFor,
  findAt,
  dungeonFor,
  gearWeightOf,
  multipliersOf,
  GEAR,
  SLOTS,
  RARITIES,
  MAX_BONUS,
} from '../src/core/dungeon.js';
import { statsFor, fighterFrom } from '../src/core/fighter.js';
import { skillsFor } from '../src/core/skills.js';
import { viewModel } from '../src/core/view.js';

const T0 = new Date('2026-08-13T09:00:00').getTime();

/** 指定の回数だけ働かせる。 */
function worked({ tools = 0, prompts = 0, sessions = 1 } = {}) {
  let state = emptyState(T0);
  for (let s = 0; s < sessions; s += 1) {
    for (let p = 0; p < Math.ceil(prompts / sessions); p += 1) {
      state = applyEvent(state, { t: T0 + s * 3600000 + p * 1000, e: 'UserPromptSubmit', s: `s${s}` });
    }
    for (let i = 0; i < Math.ceil(tools / sessions); i += 1) {
      state = applyEvent(state, { t: T0 + s * 3600000 + i * 2000, e: 'PostToolUse', s: `s${s}`, tool: 'Read', ok: true });
    }
  }
  return state;
}

test('深さは作業量から出る（働くほど潜る、戻らない）', () => {
  const light = worked({ tools: 200, prompts: 11, sessions: 1 });
  const heavy = worked({ tools: 4000, prompts: 220, sessions: 20 });
  assert.ok(floorFor(heavy) > floorFor(light), '働いたほうが浅い');
  assert.ok(floorFor(light) >= 5 && floorFor(light) <= 12, `1 日ぶんで ${floorFor(light)} 階`);
  assert.ok(floorFor(heavy) >= 25 && floorFor(heavy) <= 50, `3 週間ぶんで ${floorFor(heavy)} 階`);

  // まっさらな個体は 0 階（まだ潜っていない）
  assert.equal(floorFor(emptyState(T0)), 0);
  assert.equal(effortFor(emptyState(T0)), 0);
});

test('伸びは頭打ちにならないが、線形にもならない', () => {
  // 線形だと 1 年で 4 桁になって「深さ」の意味が消える。
  // 対数だと最初の 1 週間で止まって「潜っている感じ」が消える。
  const at = (tools) => floorFor(worked({ tools, prompts: tools / 20, sessions: Math.max(1, tools / 200) }));
  const a = at(200);
  const b = at(4000);
  const c = at(100000);
  assert.ok(b > a && c > b, '深さが伸びていない');
  assert.ok(c < 400, `1 年ぶんで ${c} 階は深すぎる`);
  assert.ok(c / b < b / a * 2, '後半のほうが急に伸びている');
});

test('同じ個体・同じ階なら、いつ引いても同じものが出る', () => {
  // 導出であることの本体。畳み直しても装備が入れ替わらない
  for (const floor of [1, 7, 40, 300]) {
    const a = findAt(12345, floor);
    const b = findAt(12345, floor);
    assert.deepEqual(a, b);
    assert.equal(a.floor, floor);
    assert.ok(GEAR.some((g) => g.id === a.id));
    assert.ok(SLOTS.includes(a.slot));
    assert.ok(RARITIES.some((r) => r.id === a.rarity));
  }
  // 個体が違えば違うものが出る
  const mine = [];
  for (let seed = 0; seed < 30; seed += 1) mine.push(findAt(seed, 10).id);
  assert.ok(new Set(mine).size > 1, 'どの個体も同じものしか拾わない');
});

test('深いほど良いものが出る（ただし最上位は最後まで珍しい）', () => {
  const shareOf = (floor, rarity) => {
    let hit = 0;
    for (let seed = 0; seed < 4000; seed += 1) {
      if (findAt(seed, floor).rarity === rarity) hit += 1;
    }
    return hit / 4000;
  };

  assert.ok(shareOf(80, 'rare') > shareOf(5, 'rare') * 2, '深くしてもレアが増えていない');
  assert.ok(shareOf(300, 'mystic') > shareOf(5, 'mystic'), '深くしてもミスティックが増えていない');
  assert.ok(shareOf(999, 'legend') > shareOf(20, 'legend'), '深くしてもレジェンドが増えていない');
  // 毎回レジェンドが出るなら、それはコモンと同じこと
  assert.ok(shareOf(999, 'mystic') < 0.15, `最深部でミスティックが ${Math.round(shareOf(999, 'mystic') * 100)}%`);
  assert.ok(shareOf(999, 'legend') < 0.06, `最深部でレジェンドが ${Math.round(shareOf(999, 'legend') * 100)}%`);
  assert.ok(shareOf(1, 'mystic') < 0.02, '1 階でいきなり上位が出る');
  assert.equal(shareOf(1, 'legend'), 0, '1 階でレジェンドが出る');

  // 位は下から上へ 5 段。順番が入れ替わると、色の意味が崩れる
  assert.deepEqual(
    RARITIES.map((r) => r.id),
    ['common', 'uncommon', 'rare', 'mystic', 'legend'],
  );
  for (let i = 1; i < RARITIES.length; i += 1) {
    assert.ok(RARITIES[i].mult > RARITIES[i - 1].mult, `${RARITIES[i].id} が下の位より弱い`);
    assert.equal(RARITIES[i].rank, i, `${RARITIES[i].id} の rank が並びと合っていない`);
  }
});

test('装備は枠ごとに一番強いものが勝手に乗る', () => {
  const state = worked({ tools: 4000, prompts: 220, sessions: 20 });
  const dungeon = dungeonFor(state);
  assert.ok(dungeon.floor > 0);

  for (const slot of SLOTS) {
    const best = dungeon.equipped[slot];
    if (!best) continue;
    /*
     * 比べるのは**総取り分**（宿りぶんを含む）。素の割合で比べると、
     * 「並だが宿りが 2 つ乗って結果的に強い」ものを一生着けないことになる。
     */
    for (let f = 1; f <= dungeon.floor; f += 1) {
      const find = findAt(state.seed || 0, f);
      if (find.slot !== slot) continue;
      assert.ok(best.total >= find.total, `${slot} に弱いほうを着けている`);
    }
  }

  // 倍率は 1 以上、頭打ちの中
  for (const slot of SLOTS) {
    const m = dungeon.multipliers[slot];
    assert.ok(m >= 1 && m <= 1 + MAX_BONUS, `${slot} の倍率が ${m}`);
  }
});

test('潜るほど強くなる（放っておくだけで数字が上がる）', () => {
  // 「眺めてるだけでどんどん強くなる」の中身。操作は何も要らない
  const shallow = dungeonFor(worked({ tools: 300, prompts: 15, sessions: 2 }));
  const deep = dungeonFor(worked({ tools: 40000, prompts: 2000, sessions: 200 }));
  assert.ok(gearWeightOf(deep.equipped) > gearWeightOf(shallow.equipped), '深く潜っても装備が良くなっていない');
});

test('装備はステータスに割合で乗る（固定値ではない）', () => {
  // 固定値だと、育つほど装備が誤差になる
  const vector = { scholar: 1, artisan: 0, seeker: 0, architect: 0, commander: 0 };
  const bare = statsFor(50, vector);
  const geared = statsFor(50, vector, { atk: 1.2, def: 1.1, spd: 1 });
  assert.ok(geared.atk > bare.atk);
  assert.equal(geared.spd, bare.spd);
  assert.ok(Math.abs(geared.atk / bare.atk - 1.2) < 0.02, '割合になっていない');

  // 高レベルでも同じ割合で効く
  const highBare = statsFor(500, vector);
  const highGear = statsFor(500, vector, { atk: 1.2, def: 1, spd: 1 });
  assert.ok(Math.abs(highGear.atk / highBare.atk - 1.2) < 0.01);
});

test('倍率が無ければ、いままでどおりの数字になる', () => {
  // 装備を足したせいで既存の個体の強さが変わってはいけない
  const vector = { artisan: 1, seeker: 0, architect: 0, scholar: 0, commander: 0 };
  assert.deepEqual(statsFor(20, vector), statsFor(20, vector, null));
  assert.deepEqual(statsFor(20, vector), statsFor(20, vector, { atk: 1, def: 1, spd: 1 }));
});

test('戦う個体に装備の取り分が乗っている（練習相手を合わせるため）', () => {
  const state = worked({ tools: 4000, prompts: 220, sessions: 20 });
  state.exp = totalExpForLevel(20);
  const fighter = fighterFrom(state);
  assert.equal(typeof fighter.gear, 'number');
  assert.ok(fighter.gear > 0, '装備の取り分が伝わっていない');
  assert.equal(fighter.gear, gearWeightOf(dungeonFor(state).equipped));
});

test('装備は state に何も足さない（畳み直せば同じものが出る）', () => {
  const state = worked({ tools: 2000, prompts: 100, sessions: 10 });
  const before = JSON.stringify(state);
  const a = dungeonFor(state);
  const b = dungeonFor(JSON.parse(before));
  assert.equal(JSON.stringify(state), before, 'dungeonFor が state を書き換えている');
  assert.deepEqual(a, b);
  // state 側に装備の欄が生えていない
  assert.equal(state.equipped, undefined);
  assert.equal(state.gear, undefined);
  assert.equal(state.floor, undefined);
});

test('viewModel にダンジョンが乗る（言語で中身は変わらない）', () => {
  const state = worked({ tools: 4000, prompts: 220, sessions: 20 });
  const ja = viewModel(state, T0, { lang: 'ja' });
  const en = viewModel(state, T0, { lang: 'en' });

  assert.ok(ja.dungeon.floor > 0);
  assert.equal(ja.dungeon.floor, en.dungeon.floor);
  assert.deepEqual(
    ja.dungeon.equipped.map((e) => `${e.slot}:${e.id}`),
    en.dungeon.equipped.map((e) => `${e.slot}:${e.id}`),
  );
  for (const item of ja.dungeon.equipped) {
    assert.ok(item.label && item.rarityLabel);
    assert.ok(item.percent >= 0);
  }
  assert.ok(ja.dungeon.recent.length > 0);
});

test('拾い物に絵の無いものが無い（枠と位が必ず付く）', () => {
  const seen = { atk: 0, def: 0, spd: 0 };
  for (const item of GEAR) {
    assert.ok(SLOTS.includes(item.slot), `${item.id} の枠が変`);
    assert.ok(item.ja && item.en, `${item.id} に名前が無い`);
    seen[item.slot] += 1;
  }
  // どの枠にも十分な数がある（1 つしか無い枠は、いつも同じものを拾う）
  for (const slot of SLOTS) assert.ok(seen[slot] >= 5, `${slot} の拾い物が ${seen[slot]} 種類しかない`);
  assert.equal(new Set(GEAR.map((g) => g.id)).size, GEAR.length, 'id が重複している');
});

test('倍率は、宿りで散らしても頭打ちを超えない', () => {
  // 宿りは枠をまたいで乗るので、足し合わせたところで頭打ちに掛け直す
  for (let floor = 1; floor <= 2000; floor += 137) {
    for (let seed = 0; seed < 20; seed += 1) {
      const find = findAt(seed, floor);
      assert.ok(find.bonus <= MAX_BONUS + 1e-9, `${floor} 階の取り分が頭打ちを超えた`);
      for (const slot of SLOTS) {
        assert.ok(find.weight[slot] <= MAX_BONUS + 1e-9, `${floor} 階の ${slot} が頭打ちを超えた`);
      }
    }
  }
  assert.equal(multipliersOf(null).atk, 1);
  const huge = { atk: { slot: 'atk', bonus: 99, imbues: ['balanced'] } };
  for (const slot of SLOTS) {
    assert.ok(multipliersOf(huge)[slot] <= 1 + MAX_BONUS + 1e-9, `${slot} が頭打ちを超えた`);
  }
});

test('宿りは、同じ装備の中身を変える', () => {
  // 拾い物の種類を増やしても「1 個あたりの深さ」は変わらない。深さは掛け算でしか増えない
  const bare = { slot: 'atk', bonus: 0.1, imbues: [] };
  const keen = { slot: 'atk', bonus: 0.1, imbues: ['keen'] };
  const light = { slot: 'atk', bonus: 0.1, imbues: ['light'] };

  assert.deepEqual(weightOf(bare), { atk: 0.1, def: 0, spd: 0 });
  // 同じ枠に寄る宿りは、その枠が厚くなる
  assert.ok(weightOf(keen).atk > weightOf(bare).atk);
  assert.equal(weightOf(keen).spd, 0);
  // 散らす宿りは、攻の武器なのに速さにも乗る ── **同じ枠でも形が変わる**
  assert.equal(weightOf(light).atk, 0.1);
  assert.ok(weightOf(light).spd > 0);
});

test('宿りは、生えている技だけを上げる', () => {
  // 技の出どころは作業ログだけ（DESIGN.md §1）。装備で技が生えると、そこが崩れる
  const state = worked({ tools: 4000, prompts: 220, sessions: 20 });
  state.exp = totalExpForLevel(30);
  state.traits.comebacks = 300; // 不屈が ★2 まで育っている
  const grown = skillsFor(state);
  const fighter = fighterFrom(state);

  for (const skill of fighter.skills) {
    const before = grown.find((s) => s.id === skill.id);
    assert.ok(before, `${skill.id} が装備で生えている`);
    assert.ok(skill.tier >= before.tier, `${skill.id} が装備で下がっている`);
    assert.ok(skill.tier <= skill.maxTier, `${skill.id} が上限を超えた`);
  }
  assert.equal(fighter.skills.length, grown.length, '装備で技の数が増えている');
});

test('宿りの段位は、上限を超えない', () => {
  const boosted = skillBoostsOf({
    atk: { imbues: ['unyielding'] },
    def: { imbues: ['unyielding'] },
    spd: { imbues: ['twinned'] },
  });
  assert.equal(boosted.fortitude, 2);
  assert.equal(boosted.summon, 1);
  assert.equal(skillBoostOf(null).fortitude, undefined);
});

test('宿りは深いほど乗りやすいが、無宿りも最後まで残る', () => {
  const shareOf = (floor, want) => {
    let hit = 0;
    for (let seed = 0; seed < 3000; seed += 1) {
      if (findAt(seed, floor).imbues.length === want) hit += 1;
    }
    return hit / 3000;
  };
  assert.ok(shareOf(200, 2) > shareOf(5, 2), '深くしても宿りが増えていない');
  assert.ok(shareOf(1, 2) < 0.05, '1 階でいきなり 2 つ宿る');
  // 全部に宿りが乗るなら、宿りは「あるのが普通」になって値打ちが消える
  assert.ok(shareOf(999, 0) > 0.15, `最深部で無宿りが ${Math.round(shareOf(999, 0) * 100)}%`);
});

test('宿りの中身は必ず画面に出る（名前だけ出さない）', () => {
  // 効果を隠すと「どれが強いのか」を外の攻略サイトで調べる遊びになる
  const state = worked({ tools: 40000, prompts: 2000, sessions: 200 });
  for (const lang of ['ja', 'en']) {
    const view = viewModel(state, T0, { lang });
    let seen = 0;
    for (const item of [...view.dungeon.equipped, ...view.dungeon.recent]) {
      for (const imbue of item.imbues) {
        assert.ok(imbue.label, `${imbue.id} に名前が無い`);
        assert.ok(imbue.blurb, `${imbue.id} に説明が無い`);
        seen += 1;
      }
      // 枠をまたいで乗るぶんも出す
      for (const w of item.weight) assert.ok(SLOTS.includes(w.slot) && w.percent > 0);
    }
    assert.ok(seen > 0, `${lang} で宿りが 1 つも出ていない`);
  }
});

test('宿りにも英語が揃っている', () => {
  const CJK = /[ぁ-ヿ一-鿿]/;
  for (const imbue of IMBUES) {
    assert.ok(imbue.ja && imbue.en, `${imbue.id} に名前が無い`);
    assert.ok(imbue.blurb && imbue.blurbEn, `${imbue.id} に説明が無い`);
    assert.ok(!CJK.test(imbue.en), `${imbue.id} の en に日本語が混ざっている`);
    // 中身は「枠を配り直す」か「技を上げる」かのどちらか
    assert.ok(Boolean(imbue.spread) !== Boolean(imbue.skill), `${imbue.id} の中身が両方 / どちらも無い`);
  }
  assert.equal(new Set(IMBUES.map((i) => i.id)).size, IMBUES.length, 'id が重複している');
});

test('六角形は、どの軸も動く（振り切ったまま止まらない）', () => {
  /*
   * **動かない軸は、軸として置く意味がない。** 体力を外したのと同じ話で、
   * 深さと続も基準を間違えると、まじめに働く人が全員振り切って止まる
   * （√(level×40) にしていた頃、90 日working の個体が深さで頭打ちだった）。
   */
  /*
   * **日をまたいで働かせる。** 1 日に詰め込むと日次 EXP 上限で頭打ちになって、
   * レベルだけが不当に低く出る ── 深さはレベルとの比で見るので、そこがズレると
   * 何を測っているのか分からなくなる。
   */
  const overDays = (days, perDay, perPrompt) => {
    let state = emptyState(T0);
    for (let d = 0; d < days; d += 1) {
      const at = T0 + d * 86400000;
      state = applyEvent(state, { t: at, e: 'UserPromptSubmit', s: `d${d}` });
      for (let i = 0; i < perDay; i += 1) {
        const t = at + i * 20000;
        // 道具は混ぜる。Read だけだと技が 1 つも生えず、技の軸が誰でも 0 になる
        const tool = ['Read', 'Grep', 'Bash', 'Edit', 'Task', 'WebSearch'][i % 6];
        state = applyEvent(state, { t, e: 'PostToolUse', s: `d${d}`, tool, ok: i % 9 !== 0 });
        if (i % 9 === 0) {
          state = applyEvent(state, { t: t + 1000, e: 'PostToolUse', s: `d${d}`, tool, ok: true });
        }
        if (i % perPrompt === perPrompt - 1) {
          state = applyEvent(state, { t: t + 500, e: 'UserPromptSubmit', s: `d${d}` });
        }
      }
    }
    return state;
  };

  const shapes = [
    ['1 日', overDays(1, 250, 20)],
    ['3 週', overDays(21, 250, 20)],
    ['90 日', overDays(90, 250, 20)],
    ['刻む人', overDays(90, 250, 4)],
  ];

  const seen = {};
  for (const [label, state] of shapes) {
    for (const axis of viewModel(state, T0).hexagon) {
      assert.ok(axis.ratio > 0 && axis.ratio <= 1, `${label} の ${axis.id} が ${axis.ratio}`);
      // 続（何日動いたか）はこの作り方だと全部同じ日になる。下の test で見る
      if (axis.id !== 'keep') (seen[axis.id] = seen[axis.id] || []).push(axis.ratio);
    }
  }

  for (const [id, values] of Object.entries(seen)) {
    const spread = Math.max(...values) - Math.min(...values);
    assert.ok(spread > 0.02, `${id} が誰でも同じ位置（幅 ${spread.toFixed(3)}）`);
    // 全部が頭打ちに張り付いていたら、それも動いていないのと同じ
    assert.ok(Math.min(...values) < 1, `${id} が常に振り切っている`);
  }

  // 1 指示あたりを細かく刻む人は、同じツール数でも深く潜る（作業量の測り方がそう）
  const at = T0 + 90 * 86400000;
  const normal = viewModel(shapes[2][1], at).hexagon.find((a) => a.id === 'depth');
  const chopped = viewModel(shapes[3][1], at).hexagon.find((a) => a.id === 'depth');
  assert.ok(chopped.ratio > normal.ratio, `刻む人 ${chopped.ratio} ≦ ふつう ${normal.ratio}`);
});

test('「続」は、休みを取る人と取らない人で変わる', () => {
  // 0.5 で割っていた頃は、毎日働く人が振り切って動かなくなっていた
  const over = (days) => {
    let state = emptyState(T0);
    for (const day of days) {
      const at = T0 + day * 86400000;
      state = applyEvent(state, { t: at, e: 'UserPromptSubmit', s: `d${day}` });
      for (let i = 0; i < 120; i += 1) {
        state = applyEvent(state, { t: at + i * 20000, e: 'PostToolUse', s: `d${day}`, tool: 'Read', ok: true });
      }
    }
    return state;
  };
  const keepOf = (state) => viewModel(state, T0 + 13 * 86400000).hexagon.find((a) => a.id === 'keep');

  const everyDay = keepOf(over([...Array(14).keys()]));
  const weekdays = keepOf(over([0, 1, 2, 3, 4, 7, 8, 9, 10, 11]));
  const rare = keepOf(over([0, 6, 13]));

  assert.ok(everyDay.ratio > weekdays.ratio, '毎日働いても週 5 と同じ');
  assert.ok(weekdays.ratio > rare.ratio, 'たまにしか働かない人と同じ');
  assert.ok(everyDay.ratio < 1, '毎日働くと振り切って止まる');
  assert.equal(everyDay.value, 14);
});

test('主は 25 階ごと。狙えないし、まだ会っていない主は出さない', () => {
  /*
   * 潜る深さは作業量で決まるので、主に会うためにできることは「普段どおり働く」
   * だけ ── 実績と同じ線（DESIGN.md §5b）。**まだ会っていない主を出すと
   * 「12 体そろえる」の話になる**（なった職を一覧に出さないのと同じ理由）。
   */
  assert.deepEqual(bossesUpTo(7, 24), []);
  assert.equal(bossesUpTo(7, 25).length, 1);
  assert.equal(bossesUpTo(7, 25)[0].floor, BOSS_EVERY);
  assert.equal(bossesUpTo(7, 130).length, 5);
  // 古い順（道として読む）
  const path = bossesUpTo(7, 130).map((b) => b.floor);
  assert.deepEqual(path, [25, 50, 75, 100, 125]);

  // 同じ個体・同じ階なら、いつ引いても同じ主
  assert.deepEqual(bossAt(7, 50), bossAt(7, 50));
  // 人によって並びが違う（全員に同じ主を置くと、階層が攻略表になる）
  const lineups = new Set();
  for (let seed = 0; seed < 40; seed += 1) lineups.add(bossesUpTo(seed, 100).map((b) => b.id).join(','));
  assert.ok(lineups.size > 5, `並びが ${lineups.size} 通りしかない`);
});

test('主は view にも乗る（新しい順・英語も揃っている）', () => {
  const state = worked({ tools: 40000, prompts: 2000, sessions: 200 });
  const CJK = /[ぁ-ヿ一-鿿]/;
  for (const lang of ['ja', 'en']) {
    const view = viewModel(state, T0, { lang });
    const bosses = view.dungeon.bosses;
    assert.ok(bosses.length >= 2, `${lang} で主が出ていない`);
    // 新しい順（いま どこにいるかから読む）
    assert.ok(bosses[0].floor > bosses[1].floor, '古い順に並んでいる');
    for (const boss of bosses) {
      assert.ok(boss.label && boss.blurb && boss.text);
      assert.equal(boss.floor % BOSS_EVERY, 0);
      if (lang === 'en') assert.ok(!CJK.test(`${boss.label}${boss.blurb}${boss.text}`), '英語に日本語が混ざっている');
    }
  }
});

test('主にも英語が揃っていて、名指しで貶していない', () => {
  const CJK = /[ぁ-ヿ一-鿿]/;
  for (const boss of BOSSES) {
    assert.ok(boss.ja && boss.en, `${boss.id} に名前が無い`);
    assert.ok(boss.blurb && boss.blurbEn, `${boss.id} に説明が無い`);
    assert.ok(!CJK.test(`${boss.en}${boss.blurbEn}`), `${boss.id} の英語に日本語が混ざっている`);
  }
  assert.equal(new Set(BOSSES.map((b) => b.id)).size, BOSSES.length, 'id が重複している');
  // 1 周ぶん（12 体）より少ないと、深い人の道が同じ顔で埋まる
  assert.ok(BOSSES.length >= 10, `主が ${BOSSES.length} 体しかいない`);
});
