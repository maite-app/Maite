import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, applyEvents } from '../src/core/growth.js';
import { skillsFor, nextSkillHints, tierOf, SKILL_IDS } from '../src/core/skills.js';

const T0 = new Date('2026-08-13T12:00:00').getTime();

/** 作業ログを畳んだ state を作る。スキルは必ずこの経路から生える。 */
function stateFrom(events) {
  return applyEvents(emptyState(T0), events);
}

test('何もしていないうちはスキルが 1 つも生えていない', () => {
  assert.deepEqual(skillsFor(emptyState(T0)), []);
  // 代わりに「何をすれば生えるか」が全件出る
  assert.equal(nextSkillHints(emptyState(T0)).length, SKILL_IDS.length);
});

test('失敗を立て直した回数が閾値を超えると不屈が生える', () => {
  const events = [];
  for (let i = 0; i < 25; i += 1) {
    events.push({ t: T0 + i * 2000, e: 'PostToolUse', tool: 'Bash', ok: false });
    events.push({ t: T0 + i * 2000 + 500, e: 'PostToolUse', tool: 'Bash', ok: true });
  }
  const state = stateFrom(events);
  assert.equal(state.traits.comebacks, 25);
  assert.equal(tierOf(skillsFor(state), 'fortitude'), 1);
});

test('段位は積み上げた量で上がる', () => {
  const events = [];
  for (let i = 0; i < 250; i += 1) {
    events.push({ t: T0 + i * 2000, e: 'PostToolUse', tool: 'Bash', ok: false });
    events.push({ t: T0 + i * 2000 + 500, e: 'PostToolUse', tool: 'Bash', ok: true });
  }
  assert.equal(tierOf(skillsFor(stateFrom(events)), 'fortitude'), 2);
});

test('比率で決まるスキルは、母数が小さいうちは生えない', () => {
  // 調べもの 1 回だけ。比率は 100% だが、これで「先読み」を取らせない。
  const tiny = stateFrom([{ t: T0, e: 'PostToolUse', tool: 'WebSearch', ok: true }]);
  assert.equal(tierOf(skillsFor(tiny), 'foresight'), 0);

  // 母数が溜まれば比率どおりに生える
  const events = [];
  for (let i = 0; i < 20; i += 1) {
    events.push({ t: T0 + i * 1000, e: 'PostToolUse', tool: 'WebSearch', ok: true });
  }
  for (let i = 0; i < 80; i += 1) {
    events.push({ t: T0 + (100 + i) * 1000, e: 'PostToolUse', tool: 'Read', ok: true });
  }
  assert.ok(tierOf(skillsFor(stateFrom(events)), 'foresight') >= 1);
});

test('Task を使うと召喚が生える', () => {
  const events = [];
  for (let i = 0; i < 10; i += 1) {
    events.push({ t: T0 + i * 1000, e: 'PostToolUse', tool: 'Task', ok: true });
  }
  assert.equal(tierOf(skillsFor(stateFrom(events)), 'summon'), 1);
});

test('compact をまたぐと記憶術が生える', () => {
  const state = stateFrom([{ t: T0, e: 'PreCompact' }]);
  assert.equal(tierOf(skillsFor(state), 'mnemonic'), 1);
});

test('生えたスキルは段位の高い順に並ぶ', () => {
  const events = [{ t: T0, e: 'PreCompact' }];
  for (let i = 0; i < 25; i += 1) {
    events.push({ t: T0 + i * 2000, e: 'PostToolUse', tool: 'Bash', ok: false });
    events.push({ t: T0 + i * 2000 + 500, e: 'PostToolUse', tool: 'Bash', ok: true });
  }
  const skills = skillsFor(stateFrom(events));
  for (let i = 1; i < skills.length; i += 1) {
    assert.ok(skills[i - 1].tier >= skills[i].tier, '段位の順に並んでいない');
  }
});

test('skillsFor は state を書き換えない', () => {
  const state = stateFrom([{ t: T0, e: 'PreCompact' }]);
  const snapshot = JSON.stringify(state);
  skillsFor(state);
  nextSkillHints(state);
  assert.equal(JSON.stringify(state), snapshot);
});

test('次の段位まで「あと何回」が出る', () => {
  const state = stateFrom([{ t: T0, e: 'PreCompact' }]);
  const mnemonic = skillsFor(state).find((s) => s.id === 'mnemonic');
  // compacts 1 で ★1。★2 の閾値は 5 なので、あと 4
  assert.equal(mnemonic.tier, 1);
  assert.equal(mnemonic.remaining, 4);
  assert.equal(mnemonic.maxTier, 3);
});

test('比率の技は「分母も増える」ぶんまで数えて残りを出す', () => {
  const events = [];
  for (let i = 0; i < 100; i += 1) {
    events.push({ t: T0 + i * 1000, e: 'PostToolUse', tool: 'Read', ok: true });
  }
  const state = stateFrom(events);
  const hint = nextSkillHints(state).find((h) => h.id === 'foresight');
  assert.equal(hint.tier, 0);

  // 出た回数ぶん実際に調べものをすれば、本当に生える
  const more = [];
  for (let i = 0; i < hint.remaining; i += 1) {
    more.push({ t: T0 + (200 + i) * 1000, e: 'PostToolUse', tool: 'WebSearch', ok: true });
  }
  assert.equal(tierOf(skillsFor(applyEvents(state, more)), 'foresight'), 1);

  // 1 回足りなければ、まだ生えない
  const almost = applyEvents(state, more.slice(0, -1));
  assert.equal(tierOf(skillsFor(almost), 'foresight'), 0);
});

test('上限まで極めた技には残りが出ない', () => {
  const events = [];
  for (let i = 0; i < 25; i += 1) events.push({ t: T0 + i * 1000, e: 'PreCompact' });
  const mnemonic = skillsFor(stateFrom(events)).find((s) => s.id === 'mnemonic');
  assert.equal(mnemonic.tier, 3);
  assert.equal(mnemonic.remaining, null);
});

test('残りは必ず 1 以上（0 や負の数を出さない）', () => {
  const events = [];
  for (let i = 0; i < 400; i += 1) {
    events.push({ t: T0 + i * 1000, e: 'PostToolUse', tool: 'Task', ok: true });
    events.push({ t: T0 + i * 1000 + 1, e: 'PostToolUse', tool: 'WebSearch', ok: true });
    if (i % 3 === 0) events.push({ t: T0 + i * 1000 + 2, e: 'PreCompact' });
  }
  let state = emptyState(T0);
  for (const ev of events) {
    state = applyEvents(state, [ev]);
    for (const s of [...skillsFor(state), ...nextSkillHints(state)]) {
      if (s.remaining === null) continue;
      assert.ok(Number.isInteger(s.remaining) && s.remaining >= 1, `${s.id} の残りが ${s.remaining}`);
    }
  }
});

test('生えたスキルは次のヒントには出ない', () => {
  const state = stateFrom([{ t: T0, e: 'PreCompact' }]);
  const hinted = nextSkillHints(state).map((h) => h.id);
  assert.ok(!hinted.includes('mnemonic'));
  assert.equal(skillsFor(state).length + hinted.length, SKILL_IDS.length);
});
