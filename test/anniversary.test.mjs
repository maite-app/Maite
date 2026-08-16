import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { anniversaryFor, MILESTONE_DAYS } from '../src/core/anniversary.js';
import { sleepTalkFor, familyOf, SLEEP_LINES } from '../src/core/sleeptalk.js';
import { dreamSeeds } from '../src/core/dreams.js';
import { recapFor } from '../src/core/recap.js';
import { emptyState, applyEvent } from '../src/core/growth.js';
import { viewModel } from '../src/core/view.js';
import { chrome, MESSAGE_IDS, LANGS } from '../src/core/i18n.js';

const DAY = 24 * 60 * 60 * 1000;
const BORN = new Date('2026-01-01T09:00:00').getTime();
const at = (days, hour = 12) => new Date(BORN + days * DAY).setHours(hour, 0, 0, 0);

test('記念日は節目の日にだけ出る', () => {
  assert.equal(anniversaryFor(BORN, at(0)), null, '生まれた日から記念日が出ている');
  assert.equal(anniversaryFor(BORN, at(29)), null);
  assert.deepEqual(anniversaryFor(BORN, at(30)), { days: 30, years: null });
  assert.equal(anniversaryFor(BORN, at(31)), null, '翌日も出続けている');
  assert.deepEqual(anniversaryFor(BORN, at(365)), { days: 365, years: 1 });
  assert.deepEqual(anniversaryFor(BORN, at(730)), { days: 730, years: 2 });

  // 節目はここから先 1 年ごと。**次がいつかは返さない**（目標にしない）
  for (const d of MILESTONE_DAYS) {
    assert.ok(anniversaryFor(BORN, at(d)), `${d} 日目に出ない`);
  }
  const out = anniversaryFor(BORN, at(30));
  assert.deepEqual(Object.keys(out).sort(), ['days', 'years'], '次の節目まで出している');
});

test('記念日は連続日数ではない ── 休んだ日も数える', () => {
  /*
   * **「途切れさせないために開く」を作らない**（DESIGN.md §3, §5b）。
   * 見ているのは bornAt からの経過日数だけなので、1 か月まるごと休んでいても
   * 30 日目は 30 日目に来る。
   */
  const worked = emptyState(BORN);
  const idle = emptyState(BORN);
  for (let i = 0; i < 50; i += 1) {
    applyEvent(worked, { t: BORN + i * 1000, e: 'PostToolUse', tool: 'Bash', ok: true });
  }
  assert.deepEqual(anniversaryFor(worked.bornAt, at(30)), anniversaryFor(idle.bornAt, at(30)));
});

test('生まれた時刻が分からなければ黙る', () => {
  assert.equal(anniversaryFor(null, at(30)), null);
  assert.equal(anniversaryFor(undefined, at(30)), null);
  assert.equal(anniversaryFor(NaN, at(30)), null);
  // 未来生まれ（時計が戻った）でも壊れない。イベントは順番どおりに来ない
  assert.equal(anniversaryFor(at(30), BORN), null);
});

test('記念日の文は view から出る（数も言語ごとに揃う）', () => {
  const state = emptyState(BORN);
  for (const lang of LANGS) {
    const view = viewModel(state, at(365), { lang });
    assert.ok(view.anniversary, `${lang} で記念日が出ない`);
    assert.equal(view.anniversary.days, 365);
    assert.ok(view.anniversary.text.length > 0);
  }
  assert.equal(viewModel(state, at(31)).anniversary, null, '節目でない日に出ている');
});

test('寝言は「最後に動いた道具」からしか出ない', () => {
  // 中身は読まない ── プロンプトもコマンドも結果も見ていない（DESIGN.md §2b）
  assert.equal(familyOf('Bash'), 'build');
  assert.equal(familyOf('Grep'), 'read');
  assert.equal(familyOf('Write'), 'write');
  assert.equal(familyOf('mcp__github__get_me'), 'out', 'MCP が外扱いになっていない');
  assert.equal(familyOf('しらない道具'), 'plain');
  assert.equal(familyOf(null), 'plain');

  // **素の寝言は必ず混ざる。** 毎晩ぴったり同じことを言う子にしない
  for (const tool of ['Bash', 'Read', 'Edit', 'WebSearch', null]) {
    const lines = sleepTalkFor(tool);
    assert.ok(lines.length >= 3, `${tool} の寝言が ${lines.length} 通りしかない`);
    for (const id of SLEEP_LINES.plain) assert.ok(lines.includes(id), `${tool} に素の寝言が無い`);
  }
});

test('寝言は責めない・急かさない', () => {
  /*
   * DESIGN.md §5 の表現の線。「まだ終わってない」「早く」の類を入れた瞬間、
   * 静かな画面が仕事の続きになる。
   */
  const NG = ['まだ', 'はやく', '早く', 'ちゃんと', 'だめ', 'ダメ', 'why', 'still', 'hurry', 'should'];
  for (const lang of LANGS) {
    const table = chrome(lang);
    for (const id of MESSAGE_IDS.filter((k) => k.startsWith('sleep.'))) {
      const line = table[id];
      assert.equal(typeof line, 'string', `${lang} に ${id} が無い`);
      assert.ok(line.length <= 24, `${id} が長すぎる（${line}）── 吹き出しは小さい`);
      for (const word of NG) {
        assert.ok(!line.toLowerCase().includes(word), `${id} に「${word}」が入っている`);
      }
    }
  }
});

test('寝言の文は view が解いて渡す（pet.js に焼き付けない）', () => {
  const state = emptyState(BORN);
  state.lastTool = 'Bash';
  const ja = viewModel(state, at(5), { lang: 'ja' }).sleepTalk;
  const en = viewModel(state, at(5), { lang: 'en' }).sleepTalk;
  assert.equal(ja.length, en.length);
  assert.notDeepEqual(ja, en, '英語でも日本語が出ている');

  const src = fs.readFileSync(new URL('../src/renderer/pet.js', import.meta.url), 'utf8');
  assert.ok(src.includes('current.sleepTalk'), 'view から引かずに寝言を出している');
});

test('夢は、本当にあったことから出る（state には何も足さない）', () => {
  /*
   * 寝言は「最後に動いた道具」から出るので、その日のことしか言えない ──
   * 毎晩おなじ 3 通りだと、眠っている絵もそこで止まる。夢は過去のほうを向く。
   *
   * **材料は view が既に持っているものだけ。** state にも events にも
   * 1 バイトも足さずに、長く一緒にいるほど種類が増える。
   */
  const bare = dreamSeeds({});
  assert.deepEqual(bare, [], '何もしていない子が夢を見ている');

  const seeds = dreamSeeds({
    bosses: [{ label: '締切の亡霊' }],
    jobs: [{ label: '鍛冶師' }, { label: '錬金術師' }],
    equipped: [{ label: 'grep の大剣' }],
    floor: 39,
    badges: [{ label: '夜警' }],
  });
  const kinds = seeds.map((s) => s.kind);
  assert.ok(kinds.includes('boss') && kinds.includes('gear') && kinds.includes('floor'));

  // **いまの職は夢に出さない** ── 今日もやっていることは、思い出ではない
  const jobs = seeds.filter((s) => s.kind === 'job').map((s) => s.ja);
  assert.deepEqual(jobs, ['鍛冶師'], 'いまの職まで夢に出ている');

  // 浅いうちは階の夢を見ない（思い出になっていない）
  assert.ok(!dreamSeeds({ floor: 2 }).some((s) => s.kind === 'floor'));
});

test('夢の文は view が解いて渡す（pet.js に焼き付けない）', () => {
  const state = emptyState(BORN);
  for (const lang of LANGS) {
    const view = viewModel(state, at(5), { lang });
    assert.ok(Array.isArray(view.dreams), `${lang} で夢が配列になっていない`);
  }
  const src = fs.readFileSync(new URL('../src/renderer/pet.js', import.meta.url), 'utf8');
  assert.ok(src.includes('current.dreams'), 'view から引かずに夢を出している');
});

test('ふりかえりは、後ろ向きにしか出さない', () => {
  /*
   * 育つのは日単位なので、眺めているあいだは何も起きていないように見える。
   * ときどき「こんなに積んだ」を返すのが、放置で育つものの素直な見返り。
   *
   * **ただし目安も、次の目標も、前月との勝ち負けも出さない** ── 出した瞬間、
   * それは追い立てになる（DESIGN.md §5b）。連続日数も出さない（実績で
   * 禁じているのと同じ理由）。
   */
  const days = {};
  const key = (i) => {
    const d = new Date(BORN + i * DAY);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  for (let i = 0; i < 30; i += 1) {
    days[key(i)] = { exp: 100 + i, tools: 50, prompts: 5, sessions: 2 };
  }
  const now = BORN + 29 * DAY;
  const recap = recapFor(days, now);
  assert.ok(recap, 'ふりかえりが出ない');
  assert.equal(recap.workedDays, 30);
  assert.equal(recap.best.day, key(29), 'いちばん多かった日がずれている');

  // **出してはいけないもの**が入り込んでいないか、名指しで見る
  for (const banned of ['streak', 'goal', 'target', 'previous', 'lastMonth', 'diff', 'rank']) {
    assert.ok(!(banned in recap), `ふりかえりに ${banned} が入っている`);
  }

  // 始めたばかりの人には返さない（「30 日で 2 日でした」は、まとめではない）
  const few = {};
  for (let i = 0; i < 4; i += 1) few[key(i)] = { exp: 100, tools: 10, prompts: 1, sessions: 1 };
  assert.equal(recapFor(few, now), null, '始めたばかりの人に成績表を返している');

  // 窓の外の日は数えない
  const old = { ...days };
  old['2020-01-01'] = { exp: 99999, tools: 99999, prompts: 999, sessions: 99 };
  assert.equal(recapFor(old, now).exp, recap.exp, '窓の外の日を数えている');
});
