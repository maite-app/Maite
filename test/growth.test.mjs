import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyState,
  applyEvent,
  applyEvents,
  levelForExp,
  totalExpForLevel,
  levelProgress,
  moodFor,
  DAILY_EXP_CAP,
  MAX_LEVEL,
  TRAIL_DAYS,
  KEEP_DAYS,
} from '../src/core/growth.js';

const T0 = new Date('2026-08-13T12:00:00').getTime();

test('レベル曲線は単調増加で、Lv1 は 0 から始まる', () => {
  assert.equal(totalExpForLevel(1), 0);
  for (let l = 1; l < 40; l += 1) {
    assert.ok(totalExpForLevel(l + 1) > totalExpForLevel(l), `Lv${l + 1} が Lv${l} を超えていない`);
  }
});

test('levelForExp は曲線の逆関数になっている', () => {
  for (let l = 1; l < 30; l += 1) {
    const need = totalExpForLevel(l);
    assert.equal(levelForExp(need), l);
    assert.equal(levelForExp(need - 1), Math.max(1, l - 1));
  }
});

test('levelForExp は上限まで曲線の逆関数になっている', () => {
  // 逆関数で当たりを付ける実装にしたので、丸めのズレが出ないことを広く確かめる
  for (const l of [1, 2, 3, 7, 25, 99, 100, 250, 500, 777, MAX_LEVEL - 1, MAX_LEVEL]) {
    const need = totalExpForLevel(l);
    assert.equal(levelForExp(need), l, `Lv${l} の境界`);
    assert.equal(levelForExp(need - 1), Math.max(1, l - 1), `Lv${l} の 1 手前`);
  }
});

test('レベルは上限で止まり、それ以上 EXP を入れても超えない', () => {
  const atCap = totalExpForLevel(MAX_LEVEL);
  assert.equal(levelForExp(atCap), MAX_LEVEL);
  assert.equal(levelForExp(atCap * 1000), MAX_LEVEL);
  assert.equal(levelForExp(Number.MAX_SAFE_INTEGER), MAX_LEVEL);

  // 上限では「次のレベル」が無い。0 除算も NaN も出さない。
  const p = levelProgress(atCap);
  assert.equal(p.level, MAX_LEVEL);
  assert.equal(p.ratio, 1);
  assert.equal(p.toNext, 0);
  assert.ok(Number.isFinite(p.into));
});

test('レベル計算は高レベルでも定数時間で終わる', () => {
  // 1 ずつ数え上げていた頃、上限付近では 1 イベント畳むのに 1 万回まわっていた。
  const high = totalExpForLevel(MAX_LEVEL);
  const started = process.hrtime.bigint();
  for (let i = 0; i < 20_000; i += 1) levelForExp(high - i);
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  assert.ok(ms < 500, `20,000 回で ${ms.toFixed(0)}ms かかっている`);
});

test('levelProgress の ratio は 0..1 に収まる', () => {
  for (const exp of [0, 1, 59, 60, 200, 1000, 9999]) {
    const p = levelProgress(exp);
    assert.ok(p.ratio >= 0 && p.ratio < 1, `exp=${exp} で ratio=${p.ratio}`);
    assert.ok(p.toNext > 0);
  }
});

test('成功したツール呼び出しが系統ベクトルを伸ばす', () => {
  let s = emptyState(T0);
  for (let i = 0; i < 10; i += 1) {
    s = applyEvent(s, { t: T0 + i * 1000, e: 'PostToolUse', tool: 'Bash', ok: true });
  }
  assert.equal(s.classVector.artisan, 10);
  assert.equal(s.classVector.scholar, 0);
  assert.equal(s.traits.toolCalls, 10);
});

test('失敗したツール呼び出しは系統を動かさないが EXP は入る', () => {
  const before = emptyState(T0);
  const after = applyEvent(before, { t: T0, e: 'PostToolUse', tool: 'Bash', ok: false });
  assert.equal(after.classVector.artisan, 0);
  assert.equal(after.traits.failures, 1);
  assert.ok(after.exp > 0);
});

test('失敗の直後に同じツールが成功すると comeback が立つ', () => {
  const s = applyEvents(emptyState(T0), [
    { t: T0, e: 'PostToolUse', tool: 'Bash', ok: false },
    { t: T0 + 1000, e: 'PostToolUse', tool: 'Bash', ok: true },
  ]);
  assert.equal(s.traits.comebacks, 1);
  // 一度回収したら再度失敗するまで立たない
  const s2 = applyEvent(s, { t: T0 + 2000, e: 'PostToolUse', tool: 'Bash', ok: true });
  assert.equal(s2.traits.comebacks, 1);
});

test('起動しただけのセッションでは EXP が入らない', () => {
  // IDE 拡張などが裏で立てて即閉じるセッション。実測で 15 分に 14 回出ていた。
  let s = emptyState(T0);
  for (let i = 0; i < 50; i += 1) {
    s = applyEvent(s, { t: T0 + i * 1000, e: 'SessionStart', s: `ghost${i}` });
    s = applyEvent(s, { t: T0 + i * 1000 + 500, e: 'SessionEnd', s: `ghost${i}` });
  }
  assert.equal(s.exp, 0);
  assert.equal(s.traits.sessions, 0);
  assert.equal(s.level, 1);
});

test('最初のプロンプトが来たときだけセッションとして数える', () => {
  let s = applyEvents(emptyState(T0), [
    { t: T0, e: 'SessionStart', s: 'real1' },
    { t: T0 + 1000, e: 'UserPromptSubmit', s: 'real1' },
  ]);
  assert.equal(s.traits.sessions, 1);
  assert.equal(s.exp, 8); // UserPromptSubmit 3 + セッション初回 5

  // 同じセッションで 2 回目以降のプロンプトにはボーナスが付かない
  s = applyEvent(s, { t: T0 + 2000, e: 'UserPromptSubmit', s: 'real1' });
  assert.equal(s.traits.sessions, 1);
  assert.equal(s.exp, 11);

  // 別セッションなら改めて 1 回だけ付く
  s = applyEvent(s, { t: T0 + 3000, e: 'UserPromptSubmit', s: 'real2' });
  assert.equal(s.traits.sessions, 2);
  assert.equal(s.exp, 19);
});

test('覚えるセッション ID には上限があり、無限に増えない', () => {
  const events = [];
  for (let i = 0; i < 500; i += 1) {
    events.push({ t: T0 + i * 1000, e: 'UserPromptSubmit', s: `sess${i}` });
  }
  const s = applyEvents(emptyState(T0), events);
  assert.ok(s.countedSessions.length <= 200, `${s.countedSessions.length} 件も覚えている`);
  // 直近のものが残っている（覚えるのは id と、最後に見た時刻）
  assert.ok(s.countedSessions.some((entry) => entry.i === 'sess499'));
});

test('nightOwl は実作業だけで数える', () => {
  const midnight = new Date('2026-08-13T02:00:00').getTime();
  let s = emptyState(midnight);
  s = applyEvent(s, { t: midnight, e: 'SessionStart', s: 'ghost' });
  s = applyEvent(s, { t: midnight, e: 'SessionEnd', s: 'ghost' });
  assert.equal(s.traits.nightOwl, 0);
  s = applyEvent(s, { t: midnight, e: 'PostToolUse', s: 'real', tool: 'Bash', ok: true });
  assert.equal(s.traits.nightOwl, 1);
});

test('系統は Lv3 未満では確定しない', () => {
  let s = emptyState(T0);
  s = applyEvent(s, { t: T0, e: 'PostToolUse', tool: 'Read', ok: true });
  assert.equal(s.level, 1);
  assert.equal(s.classId, null);
});

test('十分に使うと系統が確定し、分布が逆転すれば乗り換わる', () => {
  const events = [];
  for (let i = 0; i < 200; i += 1) {
    events.push({ t: T0 + i * 1000, e: 'PostToolUse', tool: 'Read', ok: true });
  }
  let s = applyEvents(emptyState(T0), events);
  assert.ok(s.level >= 3);
  assert.equal(s.classId, 'scholar');

  // 翌日、書く仕事に切り替える（日次キャップを跨ぐので日付を進める）
  const T1 = T0 + 24 * 60 * 60 * 1000;
  const shift = [];
  for (let i = 0; i < 400; i += 1) {
    shift.push({ t: T1 + i * 1000, e: 'PostToolUse', tool: 'Edit', ok: true });
  }
  s = applyEvents(s, shift);
  assert.equal(s.classId, 'architect');
});

test('MCP ツールは探索者に寄る', () => {
  const s = applyEvent(emptyState(T0), {
    t: T0,
    e: 'PostToolUse',
    tool: 'mcp__github__create_issue',
    ok: true,
  });
  assert.equal(s.classVector.seeker, 1);
});

test('1 日の EXP はキャップで頭打ちになる', () => {
  const events = [];
  for (let i = 0; i < 5000; i += 1) {
    events.push({ t: T0 + i * 100, e: 'PostToolUse', tool: 'Bash', ok: true });
  }
  const s = applyEvents(emptyState(T0), events);
  assert.equal(s.exp, DAILY_EXP_CAP);
  assert.equal(s.daily.exp, DAILY_EXP_CAP);
});

test('よく働いた日を、ほとんど捨てずに拾える', () => {
  // 上限 400 の頃は、作業を始めて 1.7 時間で埋まっていた。
  // 「一番使っている人の相棒が一番早く育つのをやめる」のは、この作りでは逆。
  const events = [];
  const base = new Date('2026-08-13T09:00:00').getTime();
  for (let i = 0; i < 800; i += 1) {
    const t = base + i * 30_000;
    if (i % 25 === 0) events.push({ t, e: 'UserPromptSubmit', s: 'a' });
    else events.push({ t, e: 'PostToolUse', s: 'a', tool: 'Bash', ok: i % 9 !== 0 });
  }
  let raw = 5; // セッション初回のぶん
  for (const e of events) raw += e.e === 'UserPromptSubmit' ? 3 : e.ok ? 2 : 1;

  const s = applyEvents(emptyState(base), events);
  assert.ok(s.exp / raw > 0.9, `よく働いた 1 日で ${Math.round(100 - (s.exp / raw) * 100)}% 捨てている`);
});

test('日付が変わるとキャップが復活する', () => {
  const day1 = [];
  for (let i = 0; i < 5000; i += 1) day1.push({ t: T0 + i * 100, e: 'PostToolUse', tool: 'Bash', ok: true });
  let s = applyEvents(emptyState(T0), day1);
  assert.equal(s.exp, DAILY_EXP_CAP);

  const T1 = T0 + 24 * 60 * 60 * 1000;
  s = applyEvent(s, { t: T1, e: 'PostToolUse', tool: 'Bash', ok: true });
  assert.ok(s.exp > DAILY_EXP_CAP);
  assert.equal(s.daily.exp, 2);
});

test('applyEvent は元の state を書き換えない', () => {
  const before = emptyState(T0);
  const snapshot = JSON.stringify(before);
  applyEvent(before, { t: T0, e: 'PostToolUse', tool: 'Bash', ok: true });
  assert.equal(JSON.stringify(before), snapshot);
});

test('未知のイベントで壊れない', () => {
  const s = applyEvent(emptyState(T0), { t: T0, e: 'SomethingNew' });
  assert.equal(s.level, 1);
  assert.equal(s.lastEventKind, 'SomethingNew');
});

test('moodFor が直近イベントと経過時間から気分を決める', () => {
  const base = emptyState(T0);
  const working = { ...base, lastEventAt: T0, lastEventKind: 'PreToolUse' };
  assert.equal(moodFor(working, T0 + 1000), 'working');
  assert.equal(moodFor(working, T0 + 30_000), 'idle');
  assert.equal(moodFor(working, T0 + 10 * 60_000), 'sleeping');

  const thinking = { ...base, lastEventAt: T0, lastEventKind: 'UserPromptSubmit' };
  assert.equal(moodFor(thinking, T0 + 1000), 'thinking');

  // 許可待ちは「返事を待っている間」だけ。Notification のまま席を立つのは
  // いちばん多い終わり方なので、ここが永遠に続くと一晩中呼び続けることになる。
  const calling = { ...base, lastEventAt: T0, lastEventKind: 'Notification' };
  assert.equal(moodFor(calling, T0 + 30_000), 'calling');
  assert.equal(moodFor(calling, T0 + 60 * 60_000), 'sleeping');
});

test('1 日の区切りを、渡したタイムゾーンで切れる', () => {
  // Worker のローカル時刻は UTC。指定しないと日本の昼が「夜更かし」に数えられ、
  // 日次 EXP 上限の区切りも PC と食い違う。
  const noon = Date.parse('2026-08-15T11:00:00+09:00'); // 日本の昼、UTC では 02:00

  const jst = applyEvent(emptyState(noon), { t: noon, e: 'PostToolUse', tool: 'Bash', ok: true }, { tzOffset: 540 });
  assert.equal(jst.traits.nightOwl, 0, '日本の昼が夜更かしに数えられている');
  assert.equal(jst.daily.day, '2026-08-15');

  const utc = applyEvent(emptyState(noon), { t: noon, e: 'PostToolUse', tool: 'Bash', ok: true }, { tzOffset: 0 });
  assert.equal(utc.traits.nightOwl, 1, 'UTC で見れば 02:00 なので夜更かし');
  assert.equal(utc.daily.day, '2026-08-15');

  // 日付が割れる時間帯
  const lateNight = Date.parse('2026-08-15T02:00:00+09:00'); // UTC では前日 17:00
  const a = applyEvent(emptyState(lateNight), { t: lateNight, e: 'PostToolUse', tool: 'Bash', ok: true }, { tzOffset: 540 });
  const b = applyEvent(emptyState(lateNight), { t: lateNight, e: 'PostToolUse', tool: 'Bash', ok: true }, { tzOffset: 0 });
  assert.equal(a.daily.day, '2026-08-15');
  assert.equal(b.daily.day, '2026-08-14');
  assert.equal(a.traits.nightOwl, 1, '日本の深夜 2 時は夜更かし');
  assert.equal(b.traits.nightOwl, 0);
});

test('作ったばかりの state は、その日の枠をまだ決めていない', () => {
  /*
   * **これを機械のローカル時刻で刻んでいた。** 畳むときの区切りは tzOffset で
   * 決まるので、作った機械と畳む土地がずれていると初日だけ別の枠に入る
   * ── 機械のほうが日付が先に進んでいると `today > state.daily.day` が成り立たず、
   * 初日ぶんが翌日の枠から引かれた。
   *
   * 「機械のローカル時刻を直接見ない」の見落としが 1 つ残っていた（CLAUDE.md）。
   * このテスト自体、どの土地の機械で走らせても同じ結果になる（前は落ちていた）。
   */
  assert.equal(emptyState(Date.now()).daily.day, null);

  // 機械の日付が「その土地の日付」より進んでいても、初日が翌日の枠に入らない
  const t = Date.parse('2026-08-15T00:30:00Z'); // UTC-7 の土地ではまだ 8/14
  for (const [offset, day] of [[-420, '2026-08-14'], [0, '2026-08-15'], [540, '2026-08-15']]) {
    const s = applyEvent(emptyState(t), { t, e: 'PostToolUse', tool: 'Bash', ok: true }, { tzOffset: offset });
    assert.equal(s.daily.day, day, `${offset} 分の土地で枠が ${s.daily.day} になっている`);
    assert.ok(s.daily.exp > 0, '初日ぶんが今日の枠から漏れている');
  }
});

test('タイムゾーンを渡さなければ、これまでどおり機械のローカル時刻', () => {
  const t = Date.parse('2026-08-15T11:00:00+09:00');
  const withNull = applyEvent(emptyState(t), { t, e: 'PostToolUse', tool: 'Bash', ok: true });
  const machine = new Date(t).getHours();
  assert.equal(withNull.traits.nightOwl, machine >= 0 && machine < 5 ? 1 : 0);
});

test('遅れて届いた昨日のイベントで、今日の上限が空にならない', () => {
  // 別のマシンやクラウドから届くぶんは順番が前後する。「違う日ならリセット」に
  // していたら、昨日のイベント 1 件で今日の枠が丸ごと空いて、上限 1,500 の日に
  // 3,004 EXP 入っていた。
  let s = emptyState(T0);
  for (let i = 0; i < 2000; i += 1) {
    s = applyEvent(s, { t: T0 + i * 1000, e: 'PostToolUse', tool: 'Bash', ok: true });
  }
  assert.equal(s.daily.exp, DAILY_EXP_CAP, '今日の枠が埋まっていない');
  const filled = s.exp;

  // ここで昨日のぶんが 1 件遅れて届く
  s = applyEvent(s, { t: T0 - 20 * 60 * 60 * 1000, e: 'PostToolUse', tool: 'Bash', ok: true });
  assert.equal(s.daily.exp, DAILY_EXP_CAP, '日次の枠が巻き戻っている');

  // 続きを流し込んでも、増えるのは上限までのぶんだけ
  for (let i = 0; i < 500; i += 1) {
    s = applyEvent(s, { t: T0 + (2000 + i) * 1000, e: 'PostToolUse', tool: 'Bash', ok: true });
  }
  assert.equal(s.exp, filled, `上限を超えて ${s.exp - filled} EXP 入っている`);
});

test('巻き戻ったイベントで、見た目の時計まで戻らない', () => {
  // 戻ると「働いた 1 秒後に 5 時間ぶりのお土産」が出る。
  const s = applyEvents(emptyState(T0), [
    { t: T0, e: 'PostToolUse', tool: 'Bash', ok: true },
    { t: T0 - 5 * 60 * 60 * 1000, e: 'PostToolUse', tool: 'Read', ok: true },
  ]);
  assert.equal(s.lastEventAt, T0);
  assert.equal(s.lastEventKind, 'PostToolUse');
});

test('立て直しは、同じセッションでその場で直したときだけ数える', () => {
  const fail = { t: T0, e: 'PostToolUse', tool: 'Bash', ok: false, s: 'sess1' };

  // 3 日後にたまたま同じツールが通っただけ ── 立て直しではない
  const late = applyEvents(emptyState(T0), [
    fail,
    { t: T0 + 3 * 24 * 60 * 60 * 1000, e: 'PostToolUse', tool: 'Bash', ok: true, s: 'sess1' },
  ]);
  assert.equal(late.traits.comebacks, 0);

  // 別のセッションで通ったのも数えない
  const elsewhere = applyEvents(emptyState(T0), [
    fail,
    { t: T0 + 60_000, e: 'PostToolUse', tool: 'Bash', ok: true, s: 'sess2' },
  ]);
  assert.equal(elsewhere.traits.comebacks, 0);

  // 同じセッションで、その場で直したぶんだけ
  const here = applyEvents(emptyState(T0), [
    fail,
    { t: T0 + 60_000, e: 'PostToolUse', tool: 'Bash', ok: true, s: 'sess1' },
  ]);
  assert.equal(here.traits.comebacks, 1);
});

test('日ごとの EXP が刻まれる（ここ 2 週間を出すため）', () => {
  const day2 = T0 + 24 * 60 * 60 * 1000;
  let s = emptyState(T0);
  for (let i = 0; i < 10; i += 1) {
    s = applyEvent(s, { t: T0 + i * 1000, e: 'PostToolUse', tool: 'Bash', ok: true });
  }
  for (let i = 0; i < 4; i += 1) {
    s = applyEvent(s, { t: day2 + i * 1000, e: 'PostToolUse', tool: 'Bash', ok: true });
  }
  const keys = Object.keys(s.days).sort();
  assert.equal(keys.length, 2);
  assert.equal(s.days[keys[0]].exp, 20);
  assert.equal(s.days[keys[1]].exp, 8);
  // 合計は総 EXP と一致する（上限で削られたぶんも含めて）
  assert.equal(Object.values(s.days).reduce((a, d) => a + d.exp, 0), s.exp);
  // 型の窓に使うので、その日の中身も一緒に刻まれている
  assert.equal(s.days[keys[0]].tools, 10);
  assert.equal(s.days[keys[0]].cls.artisan, 10);
});

test('日ごとの EXP は KEEP_DAYS ぶんで頭打ちになる', () => {
  /*
   * 全部持つと 1 年で 365 個の数字が state に付いて回る（スマホへ毎回送るもの）。
   *
   * **窓（TRAIL_DAYS = 14）とは別の数字。** 画面の「この 2 週間」と型は 14 日の
   * ままで、ここが 40 日なのは**ふりかえり（recap.js）のため**だけ
   * ── 混ぜると、保存を伸ばしたときに型の窓まで伸びる（実際に一度そうなった。
   * persona.js の WINDOW_DAYS を読む）。
   */
  let s = emptyState(T0);
  for (let d = 0; d < 60; d += 1) {
    s = applyEvent(s, { t: T0 + d * 24 * 60 * 60 * 1000, e: 'PostToolUse', tool: 'Bash', ok: true });
  }
  assert.equal(Object.keys(s.days).length, KEEP_DAYS);
  assert.ok(KEEP_DAYS > TRAIL_DAYS, '保存が窓より短い');

  // 捨てるのは古いほうから。最後の日は必ず残っている
  const keys = Object.keys(s.days).sort();
  const lastDay = new Date(T0 + 59 * 24 * 60 * 60 * 1000);
  const key = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  assert.equal(keys[keys.length - 1], key(lastDay));
  assert.equal(keys[0], key(new Date(T0 + (60 - KEEP_DAYS) * 24 * 60 * 60 * 1000)));
});

test('遅れて届いた昨日のぶんは、昨日の柱に乗る', () => {
  // 日次上限は今日の枠から引くが、こちらは「いつ働いたか」を出すためのもの。
  const yesterday = T0 - 24 * 60 * 60 * 1000;
  let s = applyEvent(emptyState(T0), { t: T0, e: 'PostToolUse', tool: 'Bash', ok: true });
  s = applyEvent(s, { t: yesterday, e: 'PostToolUse', tool: 'Bash', ok: true });

  const keys = Object.keys(s.days).sort();
  assert.equal(keys.length, 2, '昨日の柱が立っていない');
  assert.equal(s.days[keys[0]].exp, 2);
  assert.equal(s.days[keys[1]].exp, 2);
});

test('名前（型）が変わった瞬間を刻む', () => {
  // 「いつ変わったか」は、いまの state からは出せない ── 実績と同じ理由で残す
  const DAY = 24 * 60 * 60 * 1000;
  let s = emptyState(T0);
  const day = (index, tools, perPrompt) => {
    const start = T0 + index * DAY;
    s = applyEvent(s, { t: start, e: 'UserPromptSubmit', s: `d${index}` });
    for (let i = 0; i < 150; i += 1) {
      const t = start + i * 20000;
      s = applyEvent(s, { t, e: 'PostToolUse', s: `d${index}`, tool: tools[i % tools.length], ok: true });
      if (i % perPrompt === perPrompt - 1) s = applyEvent(s, { t: t + 500, e: 'UserPromptSubmit', s: `d${index}` });
    }
  };

  // 名乗れないうちは刻まない（見極め中のブレを履歴にすると初日に何度も変わる）
  s = applyEvent(s, { t: T0, e: 'PostToolUse', s: 'a', tool: 'Read', ok: true });
  assert.deepEqual(s.jobs, []);

  for (let d = 0; d < 20; d += 1) day(d, ['Read', 'Read', 'Grep', 'Edit'], 4);
  assert.equal(s.jobs.length, 1, '初めて名乗った瞬間が残っていない');
  const first = s.jobs[0];
  assert.ok(first.key && first.at >= T0);

  for (let d = 20; d < 40; d += 1) day(d, ['Bash', 'Bash', 'Bash', 'Edit'], 100);
  assert.ok(s.jobs.length >= 2, '変わったのに履歴が増えていない');
  assert.notEqual(s.jobs[s.jobs.length - 1].key, first.key);

  // 同じ型が続く間は増えない
  const before = s.jobs.length;
  for (let d = 40; d < 45; d += 1) day(d, ['Bash', 'Bash', 'Bash', 'Edit'], 100);
  assert.equal(s.jobs.length, before, '変わっていないのに履歴が増えている');

  // 畳み直しても同じ時刻が出る
  assert.deepEqual(applyEvents(emptyState(T0), []).jobs, []);
});

test('会話が進んでいるひと続きを 1 本と数える（ID が同じでも）', () => {
  /*
   * **セッション ID だけでは数えられない。** クラウドの Claude Code は
   * コンテナが生きている限り同じ ID を使い続けるので、実測で
   * **12.6 時間・SessionStart 22 回・プロンプト 78 件がセッション 1 本**に
   * なっていた（手元の events.jsonl で `s` の種類が 1 つだけ）。
   */
  const HOUR = 60 * 60 * 1000;
  let s = emptyState(T0);

  // 連続して打っている間は、何度打っても 1 本
  for (let i = 0; i < 20; i += 1) {
    s = applyEvent(s, { t: T0 + i * 60_000, e: 'UserPromptSubmit', s: 'same' });
  }
  assert.equal(s.traits.sessions, 1, '打つたびに本数が増えている');

  // 45 分空けて戻ってきたら、別のひと続き
  s = applyEvent(s, { t: T0 + 20 * 60_000 + 46 * 60_000, e: 'UserPromptSubmit', s: 'same' });
  assert.equal(s.traits.sessions, 2, '席を立って戻ったのに数えていない');

  // 空きが足りなければ増えない
  s = applyEvent(s, { t: T0 + 20 * 60_000 + 46 * 60_000 + 10 * 60_000, e: 'UserPromptSubmit', s: 'same' });
  assert.equal(s.traits.sessions, 2);

  /*
   * 同じ ID のまま開き直されたら、それも 1 本。**クラウドではこれが主**
   * ── ID はコンテナの寿命ぶん変わらないので、実測で SessionStart 22 回が
   * セッション 1 本になっていた。
   */
  let day = emptyState(T0);
  for (let h = 0; h < 12; h += 1) {
    day = applyEvent(day, { t: T0 + h * HOUR, e: 'SessionStart', s: 'cloud' });
    for (let i = 0; i < 6; i += 1) {
      day = applyEvent(day, { t: T0 + h * HOUR + i * 5 * 60_000, e: 'UserPromptSubmit', s: 'cloud' });
    }
  }
  assert.equal(day.traits.sessions, 12, `12 回開き直したのに ${day.traits.sessions} 本`);

  // 開いただけで打たなければ数えない（IDE 拡張が裏で立てるぶん）
  let quiet = emptyState(T0);
  for (let i = 0; i < 50; i += 1) {
    quiet = applyEvent(quiet, { t: T0 + i * 500, e: 'SessionStart', s: `ghost${i}` });
  }
  assert.equal(quiet.traits.sessions, 0, '開いただけで数えている');
  assert.equal(quiet.exp, 0);
});

test('時刻が戻っても、セッションの本数は増えない', () => {
  // イベントは順番どおりに来ない（別のマシン・クラウド・過去ログの取り込み）。
  // ここで数えると、畳み直すたびに本数が増える。
  const events = [];
  for (let i = 0; i < 30; i += 1) {
    events.push({ t: T0 + i * 60_000, e: 'UserPromptSubmit', s: 'same' });
  }
  const forward = applyEvents(emptyState(T0), events);
  const shuffled = applyEvents(emptyState(T0), [...events].reverse());
  assert.equal(forward.traits.sessions, 1);
  assert.equal(shuffled.traits.sessions, 1, '順番が乱れると本数が増える');

  // 畳み直しても同じ（何度やっても変わらない）
  assert.equal(applyEvents(emptyState(T0), events).traits.sessions, forward.traits.sessions);
});

test('職ごとに経験値が貯まる（全体の位とは別に育つ）', () => {
  /*
   * 全体が Lv10 でも、錬金術師としては Lv3 のことがある ── どの道をどれだけ
   * 歩いたかが、そこに出る。**導出できない唯一の理由**は、いまの traits からは
   * 「どの職でいたときに稼いだか」が復元できないこと（型は直近 2 週間の窓から
   * 出る導出値なので、過去のどの日に何だったかは残っていない）。
   */
  let state = emptyState(T0);
  for (let d = 0; d < 20; d += 1) {
    const start = T0 + d * 86400000;
    state = applyEvent(state, { t: start, e: 'UserPromptSubmit', s: `d${d}` });
    for (let i = 0; i < 200; i += 1) {
      const tool = ['Read', 'Grep', 'Bash', 'Edit', 'Task', 'WebSearch'][i % 6];
      const at = start + i * 20000;
      state = applyEvent(state, { t: at, e: 'PostToolUse', s: `d${d}`, tool, ok: true });
      if (i % 20 === 19) state = applyEvent(state, { t: at + 500, e: 'UserPromptSubmit', s: `d${d}` });
    }
  }

  const keys = Object.keys(state.jobExp);
  assert.ok(keys.length >= 1, '職ごとの経験値が 1 つも貯まっていない');

  const jobTotal = keys.reduce((acc, k) => acc + state.jobExp[k], 0);
  // 名乗れていないうちのぶんは誰のものでもないので、合計は全体を超えない
  assert.ok(jobTotal > 0, '職に 1 も入っていない');
  assert.ok(jobTotal <= state.exp, `職の合計 ${jobTotal} が全体の ${state.exp} を超えている`);
  for (const key of keys) {
    assert.ok(
      levelForExp(state.jobExp[key]) <= state.level,
      `${key} の位が全体（Lv${state.level}）を超えている`,
    );
  }

  // 畳み直しても同じ。ここがずれると、開くたびに職の位が変わる
  const again = applyEvents(emptyState(T0), []);
  assert.deepEqual(again.jobExp, {});
});

test('名乗れないうちは、職に経験値を貯めない', () => {
  // 3 回叩いただけの職が Lv2 で並ぶのを止める（型が settled になるまでは捨てる）
  let state = emptyState(T0);
  for (let i = 0; i < 5; i += 1) {
    state = applyEvent(state, { t: T0 + i * 60_000, e: 'PostToolUse', s: 'a', tool: 'Read', ok: true });
  }
  assert.ok(state.exp > 0, '経験値そのものが入っていない');
  assert.deepEqual(state.jobExp, {}, '名乗れていないのに職へ貯めた');
});

test('働いた日は、必ず 1 レベル以上あがる（ずっと先まで）', () => {
  /*
   * **稼ぎがレベルで増えない**のがこのアプリの形（実際に働いた量に縛られていて、
   * しかも日次上限がある）。RPG の急な曲線は「高レベルほど稼ぎも跳ねる」から
   * 成立しているので、そのまま持ってくると必ず止まる ── 1.75 のときは
   * **Lv88 で「丸 1 日 上限まで働いても 1 レベルも上がらない」**に当たっていた。
   *
   * 取るのは Diablo のパラゴンの原則。ここが崩れた時点で、眺める理由が消える。
   */
  let dead = null;
  for (let lv = 2; lv < MAX_LEVEL; lv += 1) {
    if (levelForExp(totalExpForLevel(lv) + DAILY_EXP_CAP) === lv) {
      dead = lv;
      break;
    }
  }
  assert.ok(dead === null || dead > 500, `Lv${dead} で、働いた日が 1 レベルも動かなくなる`);

  // 序盤は速いまま。**最初の数日で「育ってる感」が来ないと続かない**
  assert.ok(levelForExp(DAILY_EXP_CAP) >= 10, '上限まで働いた初日で Lv10 に届かない');
  assert.ok(levelForExp(7 * DAILY_EXP_CAP) >= 35, '1 週間で Lv35 に届かない');

  /*
   * 天井は「ゴール」ではなく「ここまでは壊れない」の保証。
   * 毎日 上限まで働いても 2 年では届かない ── 届く高さにすると意味が変わる。
   */
  assert.ok(levelForExp(730 * DAILY_EXP_CAP) < MAX_LEVEL, '2 年で上限に届いてしまう');
});
