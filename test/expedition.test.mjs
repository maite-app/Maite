import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, applyEvent } from '../src/core/growth.js';
import { expeditionFor, MIN_AWAY_MS } from '../src/core/expedition.js';
import { viewModel } from '../src/core/view.js';

const T0 = new Date('2026-08-13T12:00:00').getTime();
const HOUR = 3600000;

function stateAway(lastEventAt) {
  const state = emptyState(T0);
  state.lastEventAt = lastEventAt;
  state.seed = 4242;
  return state;
}

test('少し離れただけでは土産が出ない', () => {
  const state = stateAway(T0);
  assert.equal(expeditionFor(state, T0 + 5 * 60000), null);
  assert.equal(expeditionFor(state, T0 + MIN_AWAY_MS - 1), null);
  assert.ok(expeditionFor(state, T0 + MIN_AWAY_MS));
});

test('一度も動いていない子は探索に出ない', () => {
  assert.equal(expeditionFor(emptyState(T0), T0 + 10 * HOUR), null);
});

test('長く留守にするほど拾ってくるが、青天井にはならない', () => {
  const state = stateAway(T0);
  const count = (h) => expeditionFor(state, T0 + h * HOUR).finds.length;
  assert.ok(count(1) < count(6), '長さが効いていない');
  assert.equal(count(12), count(48), '1 日空けても 2 日空けても同じで頭打ち');
  assert.ok(count(48) <= 6);
});

test('眺めている間に拾ったものが入れ替わらない', () => {
  // 種に now を混ぜると、開いたまま置いておくだけで中身が変わってしまう
  const state = stateAway(T0);
  const a = expeditionFor(state, T0 + 3 * HOUR);
  const b = expeditionFor(state, T0 + 3 * HOUR + 60000);
  assert.deepEqual(a.finds, b.finds);
});

test('留守に入った時刻が変われば、拾うものも変わる', () => {
  const seen = new Set();
  for (let i = 0; i < 30; i += 1) {
    const trip = expeditionFor(stateAway(T0 + i * HOUR), T0 + (i + 5) * HOUR);
    seen.add(trip.finds.map((f) => f.id).join(','));
  }
  assert.ok(seen.size > 5, '毎回同じものしか拾ってこない');
});

test('たまにしか出ないものが、ちゃんとたまに出る', () => {
  let rare = 0;
  let total = 0;
  for (let i = 0; i < 400; i += 1) {
    const trip = expeditionFor(stateAway(T0 + i * 97 * 60000), T0 + i * 97 * 60000 + 8 * HOUR);
    for (const find of trip.finds) {
      total += 1;
      if (find.rare) rare += 1;
    }
  }
  const ratio = rare / total;
  assert.ok(ratio > 0.02, `珍しいものが出なさすぎ: ${(ratio * 100).toFixed(1)}%`);
  assert.ok(ratio < 0.2, `珍しいものが出すぎ: ${(ratio * 100).toFixed(1)}%`);
});

test('探索は state を書き換えないし、強さにも触らない', () => {
  const state = stateAway(T0);
  const snapshot = JSON.stringify(state);
  expeditionFor(state, T0 + 6 * HOUR);
  assert.equal(JSON.stringify(state), snapshot);

  // EXP も系統も動かない（DESIGN.md §5）
  const before = viewModel(state, T0 + 6 * HOUR);
  assert.equal(before.exp, state.exp);
  assert.equal(before.classId, state.classId);
});

test('帰ってきて作業を始めると土産は消える', () => {
  const state = stateAway(T0);
  const now = T0 + 6 * HOUR;
  assert.ok(viewModel(state, now).expedition);

  const back = applyEvent(state, { t: now, e: 'PostToolUse', tool: 'Bash', ok: true });
  assert.equal(viewModel(back, now).expedition, null);
});

test('同じ留守番で同じものを 2 つ拾わない', () => {
  // 拾ってきたのではなく壊れて見える
  for (let i = 0; i < 300; i += 1) {
    const state = stateAway(T0 + i * 41 * 60000);
    const finds = expeditionFor(state, T0 + i * 41 * 60000 + 12 * HOUR).finds;
    const ids = finds.map((f) => f.id);
    assert.equal(new Set(ids).size, ids.length, `重複した: ${ids.join(', ')}`);
  }
});
