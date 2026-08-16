import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, applyEvent } from '../src/core/growth.js';
import { nameFor, sanitizeName, NAME_MAX, NOVICE } from '../src/core/naming.js';
import { personaFor, TYPES } from '../src/core/persona.js';
import { viewModel } from '../src/core/view.js';

const T0 = new Date('2026-08-13T09:00:00').getTime();

/** 指定した使い方で、名前が付くところまで働かせる。 */
function usedAs(tools, { days = 6, perDay = 150, perPrompt = 20 } = {}) {
  let state = emptyState(T0);
  for (let d = 0; d < days; d += 1) {
    const start = T0 + d * 24 * 60 * 60 * 1000;
    state = applyEvent(state, { t: start, e: 'UserPromptSubmit', s: `d${d}` });
    for (let i = 0; i < perDay; i += 1) {
      const t = start + i * 20000;
      state = applyEvent(state, { t, e: 'PostToolUse', s: `d${d}`, tool: tools[i % tools.length], ok: true });
      if (i % perPrompt === perPrompt - 1) {
        state = applyEvent(state, { t: t + 500, e: 'UserPromptSubmit', s: `d${d}` });
      }
    }
  }
  return state;
}

test('名前は型から出る（働き方が名前になる）', () => {
  const state = usedAs(['Read', 'Read', 'Grep', 'Edit']);
  const persona = personaFor(state);
  assert.equal(persona.settled, true);
  assert.equal(nameFor(persona), TYPES[persona.key].ja);
  assert.equal(viewModel(state, T0, { lang: 'en' }).name, TYPES[persona.key].en);
  assert.equal(viewModel(state, T0).name, persona.ja);
});

test('まだ名乗れないうちは見習い', () => {
  // 3 回叩いただけで「あなたは鍛冶師です」と言われても嘘くさい
  const fresh = emptyState(T0);
  assert.equal(nameFor(personaFor(fresh)), NOVICE.ja);
  assert.equal(viewModel(fresh, T0).name, NOVICE.ja);
  // 英語で見ていれば、そちらの見習い
  assert.equal(viewModel(fresh, T0, { lang: 'en' }).name, NOVICE.en);
});

test('働き方が変われば、名前のほうが変わる', () => {
  // **放っておくと知らない間に変わっている。** 変わる理由は本人の打ち方が変わったから。
  let state = usedAs(['Read', 'Read', 'Grep', 'Edit'], { days: 20, perPrompt: 4 });
  const before = viewModel(state, T0).name;

  // 20 日目以降、叩く仕事に切り替えて、大きく投げるようになる
  for (let d = 20; d < 40; d += 1) {
    const start = T0 + d * 24 * 60 * 60 * 1000;
    state = applyEvent(state, { t: start, e: 'UserPromptSubmit', s: `x${d}` });
    for (let i = 0; i < 150; i += 1) {
      const tool = ['Bash', 'Bash', 'Bash', 'Edit'][i % 4];
      state = applyEvent(state, { t: start + i * 20000, e: 'PostToolUse', s: `x${d}`, tool, ok: true });
    }
  }
  const after = viewModel(state, T0 + 40 * 24 * 60 * 60 * 1000).name;
  assert.notEqual(after, before, `${before} のまま変わっていない`);

  // 変わった時刻が残っていて、前の名前も分かる
  const view = viewModel(state, T0 + 40 * 24 * 60 * 60 * 1000);
  assert.ok(view.persona.since, 'いつ変わったかが残っていない');
  assert.ok(view.persona.previous, '前の名前が残っていない');
  assert.ok(view.persona.history.length >= 2);
});

test('手で付けた名前は、型が変わっても勝ち続ける', () => {
  const state = usedAs(['Read', 'Grep']);
  assert.equal(viewModel(state, T0, { name: 'さくら' }).name, 'さくら');
  assert.equal(nameFor(personaFor(state), '  さくら  '), 'さくら');
});

test('名前に置けないものは既定に戻す', () => {
  const persona = personaFor(usedAs(['Read', 'Grep']));
  for (const bad of [null, undefined, '', '   ', 42, {}, '\n\t']) {
    assert.equal(nameFor(persona, bad), persona.ja, `${JSON.stringify(bad)} が名前になっている`);
  }
  assert.equal(sanitizeName('さ\nく\tら'), 'さくら');
  assert.equal([...sanitizeName('あ'.repeat(50))].length, NAME_MAX);
  // 絵文字も 1 文字として数える（サロゲートペアで割らない）
  assert.equal(sanitizeName('🐈'.repeat(20)), '🐈'.repeat(NAME_MAX));
});

test('畳み直しても同じ名前になる', () => {
  // 名前は state に持たない（型からの導出）ので、同じログなら同じ名前が出る
  const state = usedAs(['Read', 'Bash', 'Edit']);
  assert.equal(viewModel(state, T0).name, viewModel(structuredClone(state), T0).name);
});
