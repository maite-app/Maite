import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, applyEvent, applyEvents, MAX_LEVEL, totalExpForLevel } from '../src/core/growth.js';
import {
  ACHIEVEMENTS,
  ACHIEVEMENT_IDS,
  VISIBLE_IDS,
  stampUnlocked,
  unlockedList,
  lockedList,
  jobBadges,
} from '../src/core/achievements.js';
import { viewModel } from '../src/core/view.js';

const T0 = new Date('2026-08-13T12:00:00').getTime();

test('最初は 1 つも獲得していない', () => {
  const state = emptyState(T0);
  assert.deepEqual(state.achievements, {});
  assert.equal(unlockedList(state).length, 0);
  // なった職は「まだのもの」に出さない（集めに行くチェックリストにしないため）
  assert.equal(lockedList(state).length, VISIBLE_IDS.length);
  assert.equal(jobBadges(state).length, 0);
});

test('条件を満たしたイベントの時刻が、そのまま獲得時刻になる', () => {
  const state = applyEvent(emptyState(T0), { t: T0 + 5000, e: 'UserPromptSubmit', s: 'a' });
  assert.equal(state.achievements.firstStep, T0 + 5000);
});

test('一度獲ったら、後のイベントで時刻が動かない', () => {
  let state = applyEvent(emptyState(T0), { t: T0, e: 'UserPromptSubmit', s: 'a' });
  const at = state.achievements.firstStep;
  state = applyEvents(state, [
    { t: T0 + 10_000, e: 'UserPromptSubmit', s: 'b' },
    { t: T0 + 20_000, e: 'PostToolUse', tool: 'Bash', ok: true },
  ]);
  assert.equal(state.achievements.firstStep, at);
});

test('立て直すと不死鳥が付く', () => {
  const state = applyEvents(emptyState(T0), [
    { t: T0, e: 'PostToolUse', tool: 'Bash', ok: false },
    { t: T0 + 500, e: 'PostToolUse', tool: 'Bash', ok: true },
  ]);
  assert.equal(state.achievements.phoenix, T0 + 500);
});

test('5 系統すべてに触れると五道が付く', () => {
  const tools = ['Bash', 'WebSearch', 'Edit', 'Read', 'Task'];
  let state = emptyState(T0);
  tools.forEach((tool, i) => {
    state = applyEvent(state, { t: T0 + i * 1000, e: 'PostToolUse', tool, ok: true });
    // 最後の 1 つを踏むまでは付かない
    if (i < tools.length - 1) assert.equal(state.achievements.polymath, undefined);
  });
  assert.equal(state.achievements.polymath, T0 + 4000);
});

test('畳み直しても同じ実績が同じ時刻で再現される', () => {
  const events = [];
  for (let i = 0; i < 300; i += 1) {
    events.push({ t: T0 + i * 1000, e: 'PostToolUse', tool: 'Bash', ok: i % 7 !== 0 });
    if (i % 25 === 0) events.push({ t: T0 + i * 1000 + 1, e: 'UserPromptSubmit', s: `s${i}` });
  }
  const once = applyEvents(emptyState(T0), events);
  const twice = applyEvents(emptyState(T0), events);
  assert.deepEqual(once.achievements, twice.achievements);
  assert.ok(Object.keys(once.achievements).length >= 3);
});

test('applyEvent は元の state の achievements を書き換えない', () => {
  const before = emptyState(T0);
  const snapshot = JSON.stringify(before);
  applyEvent(before, { t: T0, e: 'UserPromptSubmit', s: 'a' });
  assert.equal(JSON.stringify(before), snapshot);
});

test('レベルの実績は到達した時点で付く', () => {
  let state = emptyState(T0);
  state.exp = totalExpForLevel(10) - 1;
  state = applyEvent(state, { t: T0, e: 'UserPromptSubmit', s: 'a' });
  assert.equal(state.level, 10);
  assert.equal(state.achievements.journeyman, T0);
  assert.equal(state.achievements.veteran, undefined);
});

test('上限まで行くと頂が付く', () => {
  let state = emptyState(T0);
  state.exp = totalExpForLevel(MAX_LEVEL);
  state = applyEvent(state, { t: T0, e: 'PostToolUse', tool: 'Bash', ok: true });
  assert.equal(state.level, MAX_LEVEL);
  assert.ok(state.achievements.summit);
});

test('獲得済みは新しい順、未獲得と足すと全部になる', () => {
  const state = applyEvents(emptyState(T0), [
    { t: T0, e: 'UserPromptSubmit', s: 'a' },
    { t: T0 + 1000, e: 'PostToolUse', tool: 'Bash', ok: false },
    { t: T0 + 2000, e: 'PostToolUse', tool: 'Bash', ok: true },
  ]);
  const got = unlockedList(state);
  assert.ok(got.length >= 2);
  for (let i = 1; i < got.length; i += 1) assert.ok(got[i - 1].at >= got[i].at);
  assert.equal(got.length + lockedList(state).length, VISIBLE_IDS.length);
});

test('viewModel に実績が乗る', () => {
  const state = applyEvent(emptyState(T0), { t: T0, e: 'UserPromptSubmit', s: 'a' });
  const view = viewModel(state, T0);
  assert.equal(view.achievements[0].id, 'firstStep');
  assert.equal(view.achievements[0].at, T0);
  // 総数は見せているぶんだけ（なった職は獲るまで数にも入れない）
  assert.equal(view.achievementTotal, VISIBLE_IDS.length);
  assert.ok(ACHIEVEMENT_IDS.length > VISIBLE_IDS.length, 'なった職が実績に入っていない');
  assert.equal(view.maxLevel, MAX_LEVEL);
});

test('長く使う人にも、まだ残っているものがある', () => {
  // 実測（1 日 250 ツール）で、上のほうは 6 日で 8 個・40 日で 11 個 出てしまう。
  // 振り返って気づくためのものが最初の 1 週間で終わっていたので、尻尾を足した。
  const heavy = emptyState(T0);
  heavy.exp = totalExpForLevel(100);
  heavy.level = 100;
  Object.assign(heavy.traits, {
    prompts: 4000,
    toolCalls: 60000,
    comebacks: 600,
    compacts: 120,
    sessions: 400,
    nightOwl: 300,
  });
  for (const id of Object.keys(heavy.classVector)) heavy.classVector[id] = 500;

  stampUnlocked(heavy, T0, { maxLevel: MAX_LEVEL });
  const left = lockedList(heavy);
  assert.ok(left.length >= 5, `1 年ぶん使った時点で残りが ${left.length} 個しかない`);
});

test('実績に期限も連続日数も無い（ミッションにしない）', () => {
  // 期限・連続日数・進捗バーを付けた瞬間にデイリーミッションになる（DESIGN.md §5b）。
  // 条件は「その時点の state」だけを見る述語で、いつ・何日続けたかを見ない。
  for (const id of ACHIEVEMENT_IDS) {
    const def = ACHIEVEMENTS[id];
    assert.equal(def.test.length <= 2, true, `${id} の条件が state 以外を見ている`);
    const source = def.test.toString();
    for (const banned of ['streak', 'consecutive', 'deadline', 'Date.now', '連続']) {
      assert.ok(!source.includes(banned), `${id} が「${banned}」を見ている`);
    }
  }
});

test('なった職が実績に残る', () => {
  // 名前（型）が変わるたびに、その職に「なったことがある」印が残る。
  // state.jobs は直近ぶんしか持たないので、渡り歩いた道はこちらに残る。
  const DAY = 24 * 60 * 60 * 1000;
  let state = emptyState(T0);
  const day = (index, tools, perPrompt) => {
    const start = T0 + index * DAY;
    state = applyEvent(state, { t: start, e: 'UserPromptSubmit', s: `d${index}` });
    for (let i = 0; i < 150; i += 1) {
      const t = start + i * 20000;
      state = applyEvent(state, { t, e: 'PostToolUse', s: `d${index}`, tool: tools[i % tools.length], ok: true });
      if (i % perPrompt === perPrompt - 1) state = applyEvent(state, { t: t + 500, e: 'UserPromptSubmit', s: `d${index}` });
    }
  };

  for (let d = 0; d < 20; d += 1) day(d, ['Read', 'Read', 'Grep', 'Edit'], 4);
  const first = jobBadges(state);
  assert.equal(first.length, 1, 'いまの職の印が付いていない');
  assert.ok(first[0].id.startsWith('job:'));

  for (let d = 20; d < 45; d += 1) day(d, ['Bash', 'Bash', 'Bash', 'Edit'], 100);
  const after = jobBadges(state);
  assert.ok(after.length >= 2, `職が変わったのに印が ${after.length} 個`);
  // 古い順（渡り歩いた道として読む）
  for (let i = 1; i < after.length; i += 1) assert.ok(after[i - 1].at <= after[i].at);
  // 最初になった職の印は、名前が変わった後も残っている
  assert.ok(after.some((j) => j.id === first[0].id), '前の職の印が消えている');

  // まだなっていない職は「まだのもの」に出てこない
  const lockedNames = lockedList(state).map((a) => a.id);
  assert.ok(!lockedNames.some((id) => id.startsWith('job:')), 'なっていない職が一覧に出ている');
});
