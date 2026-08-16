import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../server/src/worker.js';
import { DAILY_EXP_CAP } from '../src/core/growth.js';

/**
 * KV の最小限のふるまいだけ真似る。put/get/delete/list があれば足りる。
 *
 * **わざと遅くしてある。** 本物は往復に数ミリ秒かかるので、同時に来た 2 本の
 * 受信は「両方が読んでから、両方が書く」形に必ず重なる。即座に返すニセモノだと
 * その重なりが起きず、読んで書き戻す作りの取りこぼしをテストが見逃す。
 */
const tick = (ms) => new Promise((r) => setTimeout(r, ms));

function fakeKV() {
  const store = new Map();
  /*
   * **何回 list を引いたか数える。** KV の 1 日ぶんの list は 1,000 で、
   * 読み取り（100,000）より桁が 2 つ小さい ── ここが増える変更は、
   * 本番を丸一日止める（実際に止めた）。
   */
  const lists = { count: 0 };
  return {
    store,
    lists,
    async get(key, type) {
      await tick(1);
      const value = store.get(key);
      if (value === undefined) return null;
      return type === 'json' ? JSON.parse(value) : value;
    },
    async put(key, value) {
      await tick(2);
      store.set(key, value);
    },
    async delete(key) {
      store.delete(key);
    },
    async list({ prefix = '', cursor } = {}) {
      lists.count += 1;
      // 本物はページに切って返す。切れ目の扱いを間違えていないか見るため、
      // ここでもわざと 4 件ずつに切る。
      const all = [...store.keys()].filter((k) => k.startsWith(prefix)).sort();
      const from = cursor ? Number(cursor) : 0;
      const page = all.slice(from, from + 4);
      const done = from + page.length >= all.length;
      return {
        keys: page.map((name) => ({ name })),
        list_complete: done,
        cursor: done ? undefined : String(from + page.length),
      };
    },
  };
}

const TOKEN = 'a'.repeat(48);
const OTHER = 'b'.repeat(48);

function env() {
  return { AIPET: fakeKV() };
}

let seq = 0;
function ev(kind, extra = {}) {
  seq += 1;
  return { i: `id${seq}`, t: Date.parse('2026-08-14T10:00:00Z') + seq * 1000, e: kind, s: 'sess1', ...extra };
}

function ingest(e, events, token = TOKEN, extra = {}) {
  return worker.fetch(
    new Request('https://x/ingest', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ events, ...extra }),
    }),
    e,
  );
}

function readState(e, token = TOKEN) {
  return worker.fetch(new Request(`https://x/api/state?token=${token}`), e);
}

test('イベントを受け取って畳んだ状態を返す', async () => {
  const e = env();
  const res = await ingest(e, [
    ev('SessionStart'),
    ev('UserPromptSubmit'),
    ev('PostToolUse', { tool: 'Bash', ok: true }),
    ev('PostToolUse', { tool: 'Bash', ok: true }),
  ]);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).accepted, 4);

  const view = await (await readState(e)).json();
  assert.equal(view.exp, 12); // プロンプト3 + セッション初回5 + ツール2×2
  assert.equal(view.traits.toolCalls, 2);
  assert.equal(view.traits.sessions, 1);
});

test('同じイベントが二度届いても二重に数えない', async () => {
  const e = env();
  const batch = [ev('UserPromptSubmit'), ev('PostToolUse', { tool: 'Read', ok: true })];

  await ingest(e, batch);
  const first = (await (await readState(e)).json()).exp;

  const again = await ingest(e, batch); // 送信失敗後の再送を想定
  assert.equal((await again.json()).accepted, 0);
  assert.equal((await (await readState(e)).json()).exp, first);
});

test('PC とクラウドの記録が 1 匹に合流する', async () => {
  const e = env();
  await ingest(e, [ev('UserPromptSubmit', { s: 'pc' }), ev('PostToolUse', { s: 'pc', tool: 'Bash', ok: true })]);
  await ingest(e, [ev('UserPromptSubmit', { s: 'cloud' }), ev('PostToolUse', { s: 'cloud', tool: 'Read', ok: true })]);

  const view = await (await readState(e)).json();
  assert.equal(view.traits.sessions, 2);
  assert.equal(view.traits.toolCalls, 2);
});

test('遅れて届いたイベントも時刻順に畳まれる', async () => {
  const e = env();
  const base = Date.parse('2026-08-14T10:00:00Z');
  // 先に「あとの時刻」が届き、次に「まえの時刻」が届く
  await ingest(e, [{ i: 'late', t: base + 60_000, e: 'PostToolUse', s: 'x', tool: 'Bash', ok: true }]);
  await ingest(e, [{ i: 'early', t: base, e: 'UserPromptSubmit', s: 'x' }]);

  const view = await (await readState(e)).json();
  // 順序が崩れていても、セッションと EXP の総量は変わらない
  assert.equal(view.traits.sessions, 1);
  assert.equal(view.traits.toolCalls, 1);
  assert.equal(view.exp, 10);
});

test('トークンが違えば別の個体になる', async () => {
  const e = env();
  await ingest(e, [ev('UserPromptSubmit')], TOKEN);
  await ingest(e, [ev('UserPromptSubmit'), ev('PostToolUse', { tool: 'Bash', ok: true })], OTHER);

  const mine = await (await readState(e, TOKEN)).json();
  const theirs = await (await readState(e, OTHER)).json();
  assert.equal(mine.traits.toolCalls, 0);
  assert.equal(theirs.traits.toolCalls, 1);
});

test('トークンは KV のキーに平文で現れない', async () => {
  const e = env();
  await ingest(e, [ev('UserPromptSubmit')]);
  for (const key of e.AIPET.store.keys()) {
    assert.ok(!key.includes(TOKEN), `キーにトークンが入っている: ${key}`);
  }
});

test('知らないキーを持ち込ませない', async () => {
  const e = env();
  await ingest(e, [
    { i: 'x1', t: Date.now(), e: 'UserPromptSubmit', s: 'a', prompt: 'ひみつの本文', cwd: 'C:/Users/user/secret' },
  ]);
  const log = e.AIPET.store.get([...e.AIPET.store.keys()].find((k) => k.startsWith('log:')));
  assert.ok(!log.includes('ひみつの本文'));
  assert.ok(!log.includes('secret'));
});

test('壊れた入力とトークン無しを弾く', async () => {
  const e = env();
  assert.equal((await ingest(e, [], 'short')).status, 401);

  const noBody = await worker.fetch(
    new Request('https://x/ingest', {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}` },
      body: 'not json',
    }),
    e,
  );
  assert.equal(noBody.status, 400);

  const tooMany = await ingest(e, Array.from({ length: 1001 }, () => ev('SessionStart')));
  assert.equal(tooMany.status, 413);

  const getIngest = await worker.fetch(new Request('https://x/ingest'), e);
  assert.equal(getIngest.status, 405);
});

test('壊れたイベントが混ざっていても、まともなものは通る', async () => {
  const e = env();
  const res = await ingest(e, [
    null,
    'ただの文字列',
    { e: 'PostToolUse' }, // t が無い
    { t: 'いつか', e: 'PostToolUse' }, // t が数値でない
    ev('PostToolUse', { tool: 'Bash', ok: true }),
  ]);
  const body = await res.json();
  assert.equal(body.accepted, 1);
  assert.equal(body.skipped, 4);
});

test('スマホ用ページと素材が返る', async () => {
  const e = env();
  const page = await worker.fetch(new Request(`https://x/p/${TOKEN}`), e);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.ok(html.includes(TOKEN), 'ページにトークンが埋まっていない');

  for (const name of ['pet.css', 'mobile.css', 'pet-svg.js', 'mobile.js']) {
    const res = await worker.fetch(new Request(`https://x/assets/${name}`), e);
    assert.equal(res.status, 200, `${name} が返らない`);
    assert.ok((await res.text()).length > 0);
  }

  assert.equal((await worker.fetch(new Request('https://x/p/short'), e)).status, 404);
  assert.equal((await worker.fetch(new Request('https://x/assets/../wrangler.toml'), e)).status, 404);
  assert.equal((await worker.fetch(new Request('https://x/'), e)).status, 404);
});

test('版を上げた直後でも、読むだけで畳み直されて Lv1 に戻らない', async () => {
  // STATE_VERSION を上げると古い state は無効になる。受信時にしか畳み直して
  // いなかったせいで、次に hook が何か送ってくるまでページに Lv1 が出ていた
  // ── 生ログは無事なのに「消えた」ように見えるのが、いちばん悪い見え方。
  const e = env();
  const events = [];
  for (let i = 0; i < 400; i += 1) events.push(ev('PostToolUse', { tool: 'Bash', ok: true }));
  await ingest(e, events);

  const before = await (await readState(e)).json();
  assert.ok(before.level > 1, `貯めた直後で Lv${before.level}`);

  // 古い版の state に差し替える（= STATE_VERSION を上げた直後と同じ状態）
  const stateKey = [...e.AIPET.store.keys()].find((k) => k.startsWith('state:'));
  const stale = JSON.parse(e.AIPET.store.get(stateKey));
  const oldVersion = stale.stateVersion;
  stale.stateVersion = oldVersion - 1;
  e.AIPET.store.set(stateKey, JSON.stringify(stale));

  // 受信を挟まず、読むだけ
  const after = await (await readState(e)).json();
  assert.equal(after.level, before.level, `Lv${before.level} だったのが Lv${after.level} になった`);
  assert.equal(after.exp, before.exp);

  // 畳み直した結果は書き戻すので、次からは畳み直さない
  assert.equal(JSON.parse(e.AIPET.store.get(stateKey)).stateVersion, oldVersion);
});

test('生ログは分割して持ち、追記は末尾だけに触る', async () => {
  // 1 枚に全部入れていた頃、KV の値の上限 25MB に 2 年で届くうえ、
  // 受信のたびに全体を読んで全体を書いていた。
  const e = env();

  // 分割が起きるまで流し込む
  for (let batch = 0; batch < 12; batch += 1) {
    const events = [];
    for (let i = 0; i < 1000; i += 1) events.push(ev('PostToolUse', { tool: 'Bash', ok: true }));
    await ingest(e, events);
  }

  const logKeys = [...e.AIPET.store.keys()].filter((k) => k.startsWith('log:'));
  assert.ok(logKeys.length >= 2, `分割されていない（${logKeys.length} 枚）`);
  for (const k of logKeys) {
    assert.ok(e.AIPET.store.get(k).length <= 900 * 1024, `${k} が大きすぎる`);
  }

  // 分割しても畳み直しの結果は変わらない
  const before = await (await readState(e)).json();
  const stateKey = [...e.AIPET.store.keys()].find((k) => k.startsWith('state:'));
  const stale = JSON.parse(e.AIPET.store.get(stateKey));
  stale.stateVersion = stale.stateVersion - 1;
  e.AIPET.store.set(stateKey, JSON.stringify(stale));

  const after = await (await readState(e)).json();
  assert.equal(after.exp, before.exp, '分割したログから畳み直せていない');
  assert.equal(after.traits.toolCalls, before.traits.toolCalls);
});

test('旧形式（log:<key> の 1 枚）のログもそのまま読める', async () => {
  // 追記の作りを変えても、既に置いてある枚は読めないといけない
  const e = env();
  await ingest(e, [ev('PostToolUse', { tool: 'Bash', ok: true })]);

  // いま書かれた枚を、旧形式のキー名に置き換える
  const logKey = [...e.AIPET.store.keys()].find((k) => k.startsWith('log:'));
  const body = e.AIPET.store.get(logKey);
  const key = logKey.slice('log:'.length).split(':')[0];
  e.AIPET.store.delete(logKey);
  e.AIPET.store.set(`log:${key}`, body);
  for (const k of [...e.AIPET.store.keys()].filter((k) => k.startsWith('meta:') || k.startsWith('state:'))) {
    e.AIPET.store.delete(k);
  }

  const view = await (await readState(e)).json();
  assert.equal(view.traits.toolCalls, 1, '旧形式のログを読めていない');
});

test('同時に届いても、生ログが消えない', async () => {
  // 末尾の 1 枚を読んで足して書き戻していた頃、PC とクラウドから同時に来ると
  // 後から書いたほうが前のぶんを丸ごと消していた。生ログは畳み直しの元なので、
  // ここで消えると取り返しがつかない。
  const e = env();
  const batches = [];
  for (let b = 0; b < 6; b += 1) {
    batches.push([ev('PostToolUse', { tool: 'Bash', ok: true }), ev('UserPromptSubmit')]);
  }
  await Promise.all(batches.map((events) => ingest(e, events)));

  const log = [...e.AIPET.store.keys()]
    .filter((k) => k.startsWith('log:'))
    .map((k) => e.AIPET.store.get(k))
    .join('');
  const ids = new Set(log.split('\n').filter(Boolean).map((line) => JSON.parse(line).i));
  for (const events of batches) {
    for (const one of events) assert.ok(ids.has(one.i), `${one.i} が生ログから消えている`);
  }
});

test('過去のぶんが遅れて届いても、畳み直して二重に数えない', async () => {
  // 過去ログの取り込みは、既にあるログの前に何万件も挿し込む。送信位置は
  // 「何バイト目まで送ったか」なので、取り込んだら最初から送り直すことになる
  // ── そのとき同じイベントがもう一度届く。
  const e = env();
  // 今日のぶんで日次の枠を埋めておく。埋まっていないと「今日の枠から引く」誤りが
  // 表に出ない ── 取り込んだ過去が丸ごと 0 EXP になるのは、埋まっている日だけ。
  const today = [];
  // 上限（DAILY_EXP_CAP）ぶんを確実に超える量。上限を動かしても効くように、
  // 件数はここで計算する ── 固定の 900 件だと、上限を上げた日に静かに素通りする
  const perEvent = 2;
  const need = Math.ceil(DAILY_EXP_CAP / perEvent) + 100;
  for (let i = 0; i < need; i += 1) today.push(ev('PostToolUse', { tool: 'Bash', ok: true }));
  for (let i = 0; i < today.length; i += 500) await ingest(e, today.slice(i, i + 500));
  const before = await (await readState(e)).json();
  assert.equal(before.dailyExp, DAILY_EXP_CAP, '今日の枠が埋まっていない');

  // 送り直し（同じもの）＋ 昔の日のぶん。i を持たないのは取り込みぶんと同じ形。
  const old = [];
  for (let i = 0; i < 30; i += 1) {
    old.push({
      t: Date.parse('2026-08-01T10:00:00Z') + i * 1000,
      e: 'PostToolUse',
      tool: 'Read',
      ok: true,
      s: 'sess0',
    });
  }
  // **1 回に送れる件数には上限がある**（worker.js の MAX_BATCH）。
  // 1 本にまとめて投げると、超えたぶんが黙って落ちる ── 落ちたのが `old` だと、
  // 「取り込んだ過去が入らない」の再現ではなく、ただの送り過ぎになる。
  const resend = [...old, ...today];
  for (let i = 0; i < resend.length; i += 500) await ingest(e, resend.slice(i, i + 500));

  const after = await (await readState(e)).json();
  assert.equal(after.traits.toolCalls, before.traits.toolCalls + old.length, 'イベントの数が合わない');
  // 昔の日には昔の日の枠がある。今日の枠から引くと、取り込んだ過去が丸ごと 0 EXP になる
  assert.equal(after.exp, before.exp + old.length * 2, '過去のぶんの EXP が入っていない');

  // もう一度そっくり同じものを送っても増えない（i が無いイベントも中身で弾く）
  for (let i = 0; i < resend.length; i += 500) await ingest(e, resend.slice(i, i + 500));
  const again = await (await readState(e)).json();
  assert.equal(again.traits.toolCalls, after.traits.toolCalls);
  assert.equal(again.exp, after.exp);
});

test('知らないトークンには個体を作らない', async () => {
  // 畳み直しの入口が「生ログが無ければ空の個体」だったので、当てずっぽうの
  // URL を叩くだけで KV に Lv1 の個体が書き込めた。
  const e = env();
  const res = await readState(e, 'z'.repeat(48));
  assert.equal(res.status, 401);
  assert.equal(e.AIPET.store.size, 0, 'KV に何か書いている');
});

test('付け替えた名前がスマホにも出る（畳み直しても消えない）', async () => {
  const e = env();
  await ingest(e, [ev('UserPromptSubmit')]);
  const before = await (await readState(e)).json();
  assert.ok(before.name, '既定の名前が出ていない');

  await ingest(e, [ev('PostToolUse', { tool: 'Bash', ok: true })], TOKEN, { name: 'さくら' });
  assert.equal((await (await readState(e)).json()).name, 'さくら');

  // 名前は生ログから導けないので、畳み直しでも消えないよう別に置いてある
  for (const k of [...e.AIPET.store.keys()].filter((k) => k.startsWith('state:'))) {
    e.AIPET.store.delete(k);
  }
  assert.equal((await (await readState(e)).json()).name, 'さくら', '畳み直しで名前が消えた');

  // 名前を送らない受信では、前の名前がそのまま残る
  await ingest(e, [ev('PostToolUse', { tool: 'Read', ok: true })]);
  assert.equal((await (await readState(e)).json()).name, 'さくら');
});

test('名前として置けないものは受け取らない', async () => {
  const e = env();
  await ingest(e, [ev('UserPromptSubmit')], TOKEN, { name: '   ' });
  const view = await (await readState(e)).json();
  assert.ok(view.name && view.name.trim() === view.name);
  assert.ok(!e.AIPET.store.has([...e.AIPET.store.keys()].find((k) => k.startsWith('name:')) || 'name:none'));

  // 長すぎるものは切って受ける
  await ingest(e, [ev('UserPromptSubmit')], TOKEN, { name: 'あ'.repeat(50) });
  assert.equal([...(await (await readState(e)).json()).name].length, 16);
});

test('生ログが増えていたら、畳んだ結果を捨てて作り直す', async () => {
  /*
   * **畳んだ結果は、それを作った元のログとセットでしか正しくない。**
   *
   * KV は書いた直後に読める保証が無い（結果整合）。追記した直後の畳み直しは
   * まだ届いていない枚を見落とすことがあり、**その state がそのまま居座る**
   * ── 実際、2,996 件を 6 回に分けて送ったら、途中の畳み直しが 1 バッチぶんしか
   * 見ておらず、ツール 1,400 回が **323 回**のまま固定されていた。
   *
   * 版だけを見ていると気づけないので、**ログの構成**（枚の名前）も見る。
   */
  const e = env();
  await ingest(e, [ev('PostToolUse', { tool: 'Read', ok: true })]);
  const before = await (await readState(e)).json();
  assert.equal(before.traits.toolCalls, 1);

  // ここで state: が焼かれている（次は読むだけで済む状態）
  const key = [...e.AIPET.store.keys()].find((k) => k.startsWith('state:'));
  assert.ok(key, 'state が焼かれていない');

  /*
   * 遅れて届いた枚が、いま見えるようになった ── ingest を通さずに生ログだけが
   * 増える形。結果整合で起きるのはこれ。
   */
  const logKey = [...e.AIPET.store.keys()].find((k) => k.startsWith('log:'));
  const late = [];
  for (let i = 0; i < 30; i += 1) late.push(ev('PostToolUse', { tool: 'Bash', ok: true }));
  await e.AIPET.put(`${logKey}-late`, late.map((one) => JSON.stringify(one)).join('\n') + '\n');

  const after = await (await readState(e)).json();
  assert.equal(after.traits.toolCalls, 31, '増えた生ログを畳み直していない');

  // 作り直したものが焼き直されていて、次からはまた読むだけで済む
  const cached = JSON.parse(e.AIPET.store.get(key));
  assert.ok(cached.logSig, '構成の印が付いていない');
  assert.equal(cached.state.traits.toolCalls, 31);
});

test('構成が変わっていなければ、畳み直さない（毎回全部畳まない）', async () => {
  // 読み取りのたびに全部畳むと、イベントが増えたときに CPU 時間に収まらなくなる
  const e = env();
  await ingest(e, [ev('UserPromptSubmit'), ev('PostToolUse', { tool: 'Read', ok: true })]);
  await readState(e);

  const key = [...e.AIPET.store.keys()].find((k) => k.startsWith('state:'));
  const first = e.AIPET.store.get(key);
  await readState(e);
  assert.equal(e.AIPET.store.get(key), first, '同じログなのに焼き直している');
});

test('印の無い古いキャッシュも捨てて、畳み直す', async () => {
  /*
   * **印が無いのは、この直しより前に焼かれたもの ＝ まさに壊れている可能性が
   * あるほう。** 最初「無ければ通す」にしていて、直しをデプロイしても
   * 数字が動かなかった ── 直したい相手を、後方互換のつもりで素通りさせていた。
   */
  const e = env();
  const events = [];
  for (let i = 0; i < 20; i += 1) events.push(ev('PostToolUse', { tool: 'Read', ok: true }));
  await ingest(e, events);

  // 古い版が焼いた形（印が無く、しかも中身が足りない）を手で置く
  const key = [...e.AIPET.store.keys()].find((k) => k.startsWith('state:'));
  const stale = JSON.parse(e.AIPET.store.get(key));
  delete stale.logSig;
  stale.state.traits.toolCalls = 3;
  stale.state.exp = 6;
  e.AIPET.store.set(key, JSON.stringify(stale));

  const after = await (await readState(e)).json();
  assert.equal(after.traits.toolCalls, 20, '印の無いキャッシュを信じている');

  // 畳み直したものには印が付いていて、次からは読むだけで済む
  assert.ok(JSON.parse(e.AIPET.store.get(key)).logSig, '焼き直しに印が付いていない');
});

test('KV の list を、1 リクエストで 1 回しか引かない', async () => {
  /*
   * **これで本番が丸一日死んだ。**
   *
   * KV の 1 日ぶんの `list` は 1,000。読み 1 回で 3 回引いていて
   * （readStored → logSignature、foldFromLog、readLog）、オーバーレイが
   * 15 秒ごと・スマホが 3 秒ごとに叩いていた ── **起動して数分でその日ぶんを
   * 使い切る。** 使い切ると list() が投げるので、読みも受信もまとめて 500 に
   * 落ちて、スマホから何も見えなくなった。毎日リセットされても即また死んだ。
   *
   * 回数そのものを縛る。ここが 1 を超えたら、また同じことが起きる。
   */
  const e = env();
  const used = (before) => e.AIPET.lists.count - before;

  // 初回（畳み直しを含む）は数えない。2 回目からを見る
  await ingest(e, [ev('UserPromptSubmit')]);

  let at = e.AIPET.lists.count;
  await ingest(e, [ev('PostToolUse', { tool: 'Bash', ok: true })]);
  assert.ok(used(at) <= 1, `受信 1 回で list を ${used(at)} 回引いている`);

  at = e.AIPET.lists.count;
  await readState(e);
  assert.ok(used(at) <= 1, `読み 1 回で list を ${used(at)} 回引いている`);

  // 畳んだ結果が使える 2 回目も、増えない
  at = e.AIPET.lists.count;
  await readState(e);
  assert.ok(used(at) <= 1, `2 回目の読みで list を ${used(at)} 回引いている`);
});

test('list が尽きても、畳んだ結果は出し続ける', async () => {
  /*
   * **「少し古い数字」と「何も見えない」は、悪さの桁が違う。**
   * 畳んだ結果は KV に残っているので、出せるものはある。
   */
  const e = env();
  await ingest(e, [ev('UserPromptSubmit'), ev('PostToolUse', { tool: 'Bash', ok: true })]);
  await readState(e); // 畳んで書き戻させる

  e.AIPET.list = async () => {
    throw new Error('KV list() limit exceeded for the day.');
  };

  const res = await readState(e);
  assert.equal(res.status, 200, 'list が尽きた瞬間に何も見えなくなる');
  const view = await res.json();
  assert.ok(view.level >= 1 && view.name, '中身が空で返っている');

  // 畳んだ結果すら無い相手には、作り話をしない
  const fresh = env();
  fresh.AIPET.list = async () => {
    throw new Error('KV list() limit exceeded for the day.');
  };
  await assert.rejects(() => readState(fresh).then((r) => (r.status >= 500 ? Promise.reject(new Error('500')) : r)));
});

test('画面が叩く間隔は、1 日ぶんの list に収まる量になっている', async () => {
  /*
   * **数字を書き換えたときに、ここで気づけるようにしておく。**
   * KV の 1 日ぶんの list は 1,000。読み 1 回 = list 1 回なので、
   * 1 日の読みの合計がそれを超えたら、また同じ落ち方をする。
   */
  const fs = await import('node:fs');
  const main = fs.readFileSync(new URL('../src/main/main.js', import.meta.url), 'utf8');
  const mobile = fs.readFileSync(new URL('../src/mobile/mobile.js', import.meta.url), 'utf8');

  const pull = Number(main.match(/const PULL_MS = ([\d\s*]+);/)[1].split('*').reduce((a, b) => a * Number(b), 1));
  const pollMin = Number(mobile.match(/const POLL_MIN_MS = (\d+);/)[1]);
  const pollMax = Number(mobile.match(/const POLL_MAX_MS = (\d+);/)[1]);

  const DAY = 24 * 60 * 60 * 1000;
  // オーバーレイは 1 日中動いている前提。スマホは最悪「開きっぱなしで忘れられた」
  /*
   * 受信ぶんも足す。**実測（いちばん働いた日・イベント 5,868 件）で 188 回。**
   * 上限ぎりぎりに置かない ── 枠はアカウントごとなので、**この数字は
   * 他の人の箱でもそのまま出る。**
   */
  const INGEST_PER_DAY = 188;
  const perDay = DAY / pull + DAY / pollMax + INGEST_PER_DAY;
  assert.ok(perDay < 600, `1 日 ${Math.round(perDay)} 回の list になる（上限 1,000・余裕を見て 600 まで）`);
  assert.ok(pollMin >= 10000, `スマホが ${pollMin}ms ごとに叩く ── 短すぎる`);
  assert.ok(pollMax > pollMin, '間隔を空ける仕掛けが効いていない');
});
