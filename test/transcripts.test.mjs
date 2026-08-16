import test from 'node:test';
import assert from 'node:assert/strict';
import { eventsFromTranscript } from '../src/core/transcripts.js';
import { emptyState, applyEvents } from '../src/core/growth.js';

/** 本物と同じ形の記録を組み立てる。中身（本文・引数）もわざと入れておく。 */
const TRANSCRIPT = [
  {
    type: 'user',
    timestamp: '2026-08-13T10:00:00.000Z',
    sessionId: 'sess-abc',
    cwd: '/home/me/secret-project',
    message: { role: 'user', content: [{ type: 'text', text: '認証を直して。トークンは hunter2' }] },
  },
  {
    type: 'assistant',
    timestamp: '2026-08-13T10:00:05.000Z',
    sessionId: 'sess-abc',
    cwd: '/home/me/secret-project',
    message: {
      content: [
        { type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'rm -rf /tmp/x' } },
        { type: 'tool_use', id: 'tu2', name: 'Edit', input: { file_path: '/home/me/secret.env' } },
      ],
    },
  },
  {
    type: 'user',
    timestamp: '2026-08-13T10:00:06.000Z',
    sessionId: 'sess-abc',
    message: {
      content: [
        { type: 'tool_result', tool_use_id: 'tu1', is_error: true, content: 'permission denied' },
        { type: 'tool_result', tool_use_id: 'tu2', is_error: false, content: 'ok' },
      ],
    },
  },
  { type: 'queue-operation', timestamp: '2026-08-13T10:00:07.000Z', content: '本文が入っている行' },
]
  .map((o) => JSON.stringify(o))
  .join('\n');

test('ツールの使用と指示だけを、派生値として取り出す', () => {
  const events = eventsFromTranscript(TRANSCRIPT, (s) => s.slice(0, 4));
  assert.equal(events.length, 3);

  assert.equal(events[0].e, 'UserPromptSubmit');
  assert.equal(events[1].e, 'PostToolUse');
  assert.equal(events[1].tool, 'Bash');
  assert.equal(events[1].ok, false, 'tool_result の is_error を拾えていない');
  assert.equal(events[2].tool, 'Edit');
  assert.equal(events[2].ok, true);
});

test('中身は一切持ち出さない', () => {
  // ここが緩むと、プライバシーの主張が取り込み機能から崩れる（DESIGN.md §2b）
  const events = eventsFromTranscript(TRANSCRIPT, (s) => s.slice(0, 4));
  const dumped = JSON.stringify(events);
  for (const secret of ['hunter2', 'rm -rf', 'secret.env', 'secret-project', '本文が入っている', 'permission denied']) {
    assert.ok(!dumped.includes(secret), `${secret} が漏れている`);
  }
  // 持ち出してよいキーだけであること
  for (const e of events) {
    assert.deepEqual(
      Object.keys(e).sort(),
      e.e === 'PostToolUse' ? ['e', 'ok', 'p', 's', 't', 'tool'] : ['e', 'p', 's', 't'],
    );
  }
});

test('セッションと作業ディレクトリはハッシュしてから入る', () => {
  const events = eventsFromTranscript(TRANSCRIPT, () => 'HASHED');
  assert.equal(events[0].s, 'HASHED');
  assert.equal(events[0].p, 'HASHED');
});

test('tool_result だけの行は「指示」に数えない', () => {
  const events = eventsFromTranscript(TRANSCRIPT, (s) => s);
  assert.equal(events.filter((e) => e.e === 'UserPromptSubmit').length, 1);
});

test('壊れた行が混ざっていても、読めるところまで取れる', () => {
  const broken = TRANSCRIPT + '\n{"type":"assistant","timestamp":"2026-08-1';
  assert.equal(eventsFromTranscript(broken, (s) => s).length, 3);
  assert.deepEqual(eventsFromTranscript('', (s) => s), []);
});

test('取り出したイベントは、そのまま成長ロジックに流せる', () => {
  // 遡って取り込むとき、hook が書いたものと同じ扱いになる必要がある
  const events = eventsFromTranscript(TRANSCRIPT, (s) => s.slice(0, 4));
  const state = applyEvents(emptyState(events[0].t), events);
  assert.equal(state.traits.prompts, 1);
  assert.equal(state.traits.toolCalls, 2);
  assert.equal(state.traits.failures, 1);
  assert.equal(state.traits.sessions, 1);
  assert.ok(state.exp > 0);
});
