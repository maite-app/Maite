import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, applyEvent, TRAIL_DAYS, KEEP_DAYS } from '../src/core/growth.js';
import { personaFor, AXES, RHYTHM, TYPES, TYPE_KEYS, WINDOW_DAYS } from '../src/core/persona.js';
import { viewModel } from '../src/core/view.js';

const T0 = new Date('2026-08-13T09:00:00').getTime();

/**
 * 使い方を捏造する。**イベントの中身は hook が書くものと同じ形**
 * （時刻・種別・ツール名・成否・セッション）で、本文は最初から存在しない。
 */
function usedAs({ tools, sessions = 6, perSession = 120, perPrompt = 20 }) {
  let state = emptyState(T0);
  let t = T0;
  for (let s = 0; s < sessions; s += 1) {
    state = applyEvent(state, { t: (t += 1000), e: 'UserPromptSubmit', s: `s${s}` });
    for (let i = 0; i < perSession; i += 1) {
      t += 20000;
      const tool = tools[i % tools.length];
      state = applyEvent(state, { t, e: 'PostToolUse', s: `s${s}`, tool, ok: i % 11 !== 0 });
      if (i % perPrompt === perPrompt - 1) {
        state = applyEvent(state, { t: t + 500, e: 'UserPromptSubmit', s: `s${s}` });
      }
    }
    t += 24 * 60 * 60 * 1000;
  }
  return state;
}

test('16 通りすべてに二つ名がある', () => {
  assert.equal(TYPE_KEYS.length, 16);
  const names = new Set();
  for (const reach of ['in', 'out']) {
    for (const hand of ['move', 'build']) {
      for (const grip of ['cut', 'trust']) {
        for (const run of ['through', 'spread']) {
          const key = `${reach}.${hand}.${grip}.${run}`;
          const type = TYPES[key];
          assert.ok(type, `${key} の二つ名が無い`);
          assert.ok(type.ja && type.yomi && type.blurb);
          names.add(type.ja);
        }
      }
    }
  }
  assert.equal(names.size, 16, '同じ二つ名が重複している');
});

test('借りてきた診断の 4 文字は、どこにも出てこない', () => {
  // 骨格は借りているが、そのまま「INTJ-T」と出すと、その人の子から生えたものではなく
  // 診断結果に見える。出るのは二つ名と、その根拠にした軸だけ。
  const shown = JSON.stringify(personaFor(usedAs({ tools: ['Read', 'Bash'] })));
  assert.ok(!/\b[IE][SN][TF][JP]\b/.test(shown), `4 文字コードが混ざっている: ${shown.slice(0, 200)}`);
  for (const axis of [...AXES, RHYTHM]) {
    for (const side of [axis.left, axis.right]) {
      assert.ok(side.code.length > 1, `${axis.id} の印が 1 文字（借り物に見える）: ${side.code}`);
    }
  }
});

test('使い方が違えば違う型が出る', () => {
  // 全員が同じ型になるなら、軸として意味が無い
  const cases = {
    読む: usedAs({ tools: ['Read', 'Read', 'Grep', 'Edit'], perPrompt: 4 }),
    叩く: usedAs({ tools: ['Bash', 'Bash', 'Bash', 'Edit'], perPrompt: 4 }),
    調べる: usedAs({ tools: ['WebSearch', 'Read', 'Task', 'Bash'], perPrompt: 4 }),
    委ねる: usedAs({ tools: ['Read', 'Read', 'Grep', 'Edit'], perPrompt: 100 }),
    散らす: usedAs({ tools: ['Read', 'Read', 'Grep', 'Edit'], perPrompt: 4, sessions: 40, perSession: 12 }),
  };
  const names = new Set(Object.values(cases).map((s) => personaFor(s).ja));
  assert.ok(names.size >= 4, `5 通りの使い方から ${names.size} 通りしか出ていない: ${[...names]}`);

  // それぞれの軸が、狙いどおりの側に出ている
  const at = (state, id) => personaFor(state).axes.find((a) => a.id === id);
  assert.equal(at(cases.叩く, 'hand').code, 'move', 'Bash 中心が「動かす」にならない');
  assert.equal(at(cases.読む, 'hand').code, 'build', 'Read 中心が「組み立てる」にならない');
  assert.equal(at(cases.調べる, 'reach').code, 'out', '調べもの中心が「出て行く」にならない');
  assert.equal(at(cases.読む, 'reach').code, 'in', '手元中心が「籠る」にならない');
  assert.equal(at(cases.委ねる, 'grip').code, 'trust', '大きく投げる人が「委ねる」にならない');
  assert.equal(at(cases.読む, 'grip').code, 'cut', '細かく刻む人が「刻む」にならない');
  assert.equal(at(cases.散らす, 'run').code, 'spread', '細切れの人が「散らす」にならない');
  assert.equal(at(cases.読む, 'run').code, 'through', '長丁場の人が「走り切る」にならない');
});

test('母数が足りないうちは断定しない', () => {
  // 3 回叩いただけで「あなたはこういう人です」と言われたら、当たっていても嘘くさい
  const fresh = emptyState(T0);
  assert.equal(personaFor(fresh).settled, false);
  for (const axis of personaFor(fresh).axes) assert.equal(axis.known, false);

  const grown = usedAs({ tools: ['Read', 'Bash', 'Edit', 'WebSearch'] });
  assert.equal(personaFor(grown).settled, true);
});

test('型は state を書き換えない（何度呼んでも同じ）', () => {
  const state = usedAs({ tools: ['Read', 'Bash'] });
  const snapshot = JSON.stringify(state);
  const first = personaFor(state);
  const second = personaFor(state);
  assert.equal(JSON.stringify(state), snapshot, 'state を書き換えている');
  assert.deepEqual(first, second);
});

test('型は state に保存しない（技と同じで導出のまま）', () => {
  // 保存すると、閾値を変えるたびに STATE_VERSION を上げる話になる
  const state = usedAs({ tools: ['Read', 'Bash'] });
  const keys = Object.keys(state);
  assert.ok(!keys.some((k) => /persona|type|mbti/i.test(k)), `state に型が入っている: ${keys}`);
});

test('目盛りの位置は 0..1 に収まり、境目が真ん中に来る', () => {
  // 生の比率をそのまま置くと、閾値 0.12 の軸だけ目盛りが左端に固まる
  for (const state of [emptyState(T0), usedAs({ tools: ['Read'] }), usedAs({ tools: ['WebSearch', 'Task'] })]) {
    for (const axis of personaFor(state).axes) {
      assert.ok(axis.position >= 0 && axis.position <= 1, `${axis.id} の位置が ${axis.position}`);
      const side = axis.position >= 0.5 ? axis.right.code : axis.left.code;
      assert.equal(axis.code, side, `${axis.id} で、選ばれた側と目盛りの向きが食い違っている`);
    }
  }
});

test('どの軸にも根拠が付いている', () => {
  // 「あなたは○○型です」だけだと占いになる。何を見てそう言ったかを必ず出す
  for (const axis of personaFor(usedAs({ tools: ['Read', 'Bash'] })).axes) {
    assert.ok(axis.from && axis.from.length > 0, `${axis.id} に根拠が無い`);
    assert.ok(axis.blurb && axis.blurb.length > 0);
  }
  assert.equal(AXES.length, 4);
});

test('viewModel に型が乗る', () => {
  const view = viewModel(usedAs({ tools: ['Read', 'Bash'] }), T0);
  assert.equal(view.persona.key.split('.').length, 4);
  // 表示名は `label`。生の `ja` は view には出さない（英語で見たとき混ざるため）
  assert.ok(view.persona.label);
  assert.equal(view.persona.ja, undefined);
  assert.ok(view.persona.title);
  // 4 文字 ＋ リズム
  assert.equal(view.persona.axes.length, 5);
});

test('リズム（5 軸目）は、働いた日ごとの量の揃い方で決まる', () => {
  // 同じ型でも走り方が違う ── 毎日おなじ調子で積む人と、乗った日に一気に持っていく人
  const steady = usedAs({ tools: ['Read', 'Bash'], sessions: 8, perSession: 120 });
  assert.equal(personaFor(steady).rhythm.code, 'calm', '毎日同じ量なのに「波」になっている');

  // 同じ日数でも、量に濃淡があれば「波」
  let spiky = emptyState(T0);
  let t = T0;
  for (const load of [40, 500, 30, 460, 20, 380, 25, 420]) {
    spiky = applyEvent(spiky, { t, e: 'UserPromptSubmit', s: `x${t}` });
    for (let i = 0; i < load; i += 1) {
      spiky = applyEvent(spiky, { t: t + i * 20000, e: 'PostToolUse', s: `x${t}`, tool: 'Read', ok: true });
    }
    t += 24 * 60 * 60 * 1000;
  }
  assert.equal(personaFor(spiky).rhythm.code, 'wave', '濃淡があるのに「凪」になっている');

  // 休んだ日は数えない（土日を休む人が全員「波」になってしまう）
  const resting = personaFor(steady);
  assert.equal(resting.rhythm.known, true);
  assert.ok(resting.title.includes('（'), `${resting.title} にリズムが付いていない`);
});

test('リズムは 4 軸より遅れて付く', () => {
  // 5 日ぶん働かないと「揃っているか」は言えない。揃うのを待つと 1 週間なにも出ない
  const young = usedAs({ tools: ['Read', 'Bash'], sessions: 3, perSession: 200 });
  const persona = personaFor(young);
  assert.equal(persona.settled, true, '4 軸が決まっていない');
  assert.equal(persona.rhythmSettled, false);
  assert.equal(persona.title.includes('（'), false, '母数が足りないのにリズムを名乗っている');
  assert.equal(persona.marks.length, 4, 'リズムの印まで見た目に流れている');
});

test('型は直近の窓で決まる（累計だと二度と変わらない）', () => {
  // 累計で決めていた頃は、続けるほど分母が育って**一度決まった型が動かなかった**
  // ── 1 年使った人は、以降どう働き方を変えても同じ名前のままだった。
  const DAY = 24 * 60 * 60 * 1000;
  let state = emptyState(T0);
  const day = (index, tools, perPrompt) => {
    const start = T0 + index * DAY;
    state = applyEvent(state, { t: start, e: 'UserPromptSubmit', s: `d${index}` });
    for (let i = 0; i < 150; i += 1) {
      const t = start + i * 20000;
      state = applyEvent(state, { t, e: 'PostToolUse', s: `d${index}`, tool: tools[i % tools.length], ok: true });
      if (i % perPrompt === perPrompt - 1) {
        state = applyEvent(state, { t: t + 500, e: 'UserPromptSubmit', s: `d${index}` });
      }
    }
  };

  // 60 日ぶん、読んで刻む働き方
  for (let d = 0; d < 60; d += 1) day(d, ['Read', 'Read', 'Grep', 'Edit'], 4);
  const long = personaFor(state).key;

  // そこから 20 日、叩いて大きく投げる働き方に変える
  for (let d = 60; d < 80; d += 1) day(d, ['Bash', 'Bash', 'Bash', 'Edit'], 100);
  const now = personaFor(state).key;

  assert.notEqual(now, long, `60 日ぶんの累計に引きずられて ${long} のまま`);
  assert.equal(now.split('.')[1], 'move', '叩く働き方になったのに「組み立てる」のまま');
  assert.equal(now.split('.')[2], 'trust', '大きく投げているのに「刻む」のまま');
});

test('境目に乗っている日は、これまでの自分に倒す', () => {
  // 窓だけで決めると、境目に乗った日から毎日ひっくり返る。
  // 「知らない間に変わっていた」はいいが「毎朝ちがう名前」は別物。
  const state = usedAs({ tools: ['Read', 'Bash'], sessions: 8, perSession: 150 });
  const persona = personaFor(state);
  const wobbling = persona.axes.filter((a) => a.wobbling);
  // 境目にいる軸があってもなくてもいいが、いるなら印が付いている
  for (const axis of wobbling) {
    assert.ok(Math.abs(axis.value - axis.threshold) < 0.06, `${axis.id} の印が実際とずれている`);
  }
  // 何度呼んでも同じ（同じ state から違う名前が出ない）
  assert.equal(personaFor(state).key, persona.key);
});


test('型の窓は、保存している日数に引きずられない', () => {
  /*
   * **前は「保存している日数 = 窓」という暗黙の前提に乗っていた。**
   * ふりかえり（recap.js）のために保存を 40 日に伸ばした瞬間、型が 40 日で
   * 決まるようになって窓が壊れた ── テストが捕まえた。
   *
   * 窓（WINDOW_DAYS）と保存（KEEP_DAYS）は別物で、窓は「この 2 週間」
   * （TRAIL_DAYS）と同じ数でなければならない。
   */
  assert.equal(WINDOW_DAYS, TRAIL_DAYS, '型の窓と「この 2 週間」がずれている');
  assert.ok(KEEP_DAYS > WINDOW_DAYS, '保存が窓より短い ── ふりかえりが出せない');

  // 窓の外の日は、型に 1 も効かない
  const state = emptyState(T0);
  state.days = {};
  for (let i = 0; i < KEEP_DAYS; i += 1) {
    const day = new Date(T0 - i * 86400000);
    const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
    // 古い日だけ「探索者」に倒しておく。窓の中は「職人」だけ
    state.days[key] = {
      exp: 100,
      tools: 100,
      prompts: 10,
      sessions: 2,
      cls: i < WINDOW_DAYS ? { artisan: 100 } : { seeker: 100 },
    };
  }
  const windowed = personaFor(state);
  const only = { ...state, days: Object.fromEntries(Object.entries(state.days).sort().slice(-WINDOW_DAYS)) };
  assert.deepEqual(windowed.marks, personaFor(only).marks, '窓の外の日が型に効いている');
});
