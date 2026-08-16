import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/*
 * paths.js は読み込んだ時点で AIPET_HOME を見るので、import より先に決める。
 * 本番のデータ（~/.aipet）には絶対に触らない。
 */
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aipet-state-'));
process.env.AIPET_HOME = HOME;

const { saveState, loadState, tick } = await import('../src/core/state.js');
const { STATE_FILE, EVENTS_FILE, CURSOR_FILE } = await import('../src/core/paths.js');
const { emptyState } = await import('../src/core/growth.js');

/** renameSync を一時的に転ばせる。Windows の EPERM を手元で再現する。 */
function breakRename(times, code = 'EPERM') {
  const real = fs.renameSync;
  let left = times;
  fs.renameSync = (from, to) => {
    if (left > 0) {
      left -= 1;
      const error = new Error(`${code}: operation not permitted, rename '${from}' -> '${to}'`);
      error.code = code;
      throw error;
    }
    return real(from, to);
  };
  return () => {
    fs.renameSync = real;
  };
}

const tmpFiles = () => fs.readdirSync(HOME).filter((name) => name.endsWith('.tmp'));

test('ふつうに保存できる', () => {
  const state = emptyState(1000);
  state.exp = 42;
  assert.equal(saveState(state), true);
  assert.equal(loadState().exp, 42);
  assert.deepEqual(tmpFiles(), [], '一時ファイルが残っている');
});

test('Windows で rename が弾かれても、掛け直して保存できる', () => {
  /*
   * ウイルス対策・検索インデクサ・OneDrive の同期・もう 1 つ立ち上がっている
   * オーバーレイ ── どれかが同じ瞬間に開いていると、Windows の rename は
   * **EPERM で落ちる**。数十ミリ秒後には空いていることがほとんど。
   */
  const restore = breakRename(2);
  try {
    const state = emptyState(1000);
    state.exp = 777;
    assert.equal(saveState(state), true);
    assert.equal(loadState().exp, 777, '掛け直しで保存できていない');
  } finally {
    restore();
  }
  assert.deepEqual(tmpFiles(), [], '一時ファイルが残っている');
});

test('掛け直しても駄目なら、直接書きに落ちる（それでも保存する）', () => {
  // 原子性は失うが、state.json は events.jsonl から作り直せるただの控え。
  // **アプリが死ぬほうがずっと悪い。**
  const restore = breakRename(Infinity);
  try {
    const state = emptyState(1000);
    state.exp = 12345;
    assert.equal(saveState(state), true);
    assert.equal(loadState().exp, 12345, '直接書きに落ちていない');
  } finally {
    restore();
  }
  assert.deepEqual(tmpFiles(), [], '一時ファイルが残っている');
});

test('どうやっても書けないときも、投げずに false を返す', () => {
  /*
   * ここで例外が外に出ると Electron の main プロセスが落ちて、画面いっぱいの
   * エラーダイアログになる ── 実際にそうなった。**相棒のために本体を止めない。**
   */
  const restoreRename = breakRename(Infinity);
  const realWrite = fs.writeFileSync;
  fs.writeFileSync = (file) => {
    const error = new Error(`EPERM: operation not permitted, open '${file}'`);
    error.code = 'EPERM';
    throw error;
  };
  try {
    let result;
    assert.doesNotThrow(() => {
      result = saveState(emptyState(1000));
    }, '保存の失敗が例外として外に出ている');
    assert.equal(result, false);
  } finally {
    fs.writeFileSync = realWrite;
    restoreRename();
  }
});

test('保存できなかったら、読み位置を進めない', () => {
  /*
   * 進めると「読んだことになったのに畳まれていない」イベントが永久に落ちる。
   * 進めなければ、次の周回で同じ範囲をもう一度読んで畳み直すだけで済む。
   */
  fs.writeFileSync(
    EVENTS_FILE,
    [
      JSON.stringify({ t: 2000, e: 'UserPromptSubmit', s: 'a' }),
      JSON.stringify({ t: 3000, e: 'PostToolUse', s: 'a', tool: 'Read', ok: true }),
    ].join('\n') + '\n',
  );
  fs.rmSync(CURSOR_FILE, { force: true });
  fs.rmSync(STATE_FILE, { force: true });

  const restoreRename = breakRename(Infinity);
  const realWrite = fs.writeFileSync;
  fs.writeFileSync = (file, data) => {
    if (String(file).includes('state.json')) {
      const error = new Error('EPERM');
      error.code = 'EPERM';
      throw error;
    }
    return realWrite(file, data);
  };

  let after;
  try {
    after = tick(emptyState(1000));
  } finally {
    fs.writeFileSync = realWrite;
    restoreRename();
  }

  // 画面には新しい数字が出ていい（保存の成否とは別の話）
  assert.ok(after.changed);
  assert.ok(after.state.exp > 0, '畳んだ結果が返ってきていない');
  // 読み位置は進んでいない
  assert.equal(fs.existsSync(CURSOR_FILE), false, '保存に失敗したのに読み位置を進めた');

  // 次の周回で、同じイベントをもう一度畳める
  const retry = tick(emptyState(1000));
  assert.equal(retry.state.exp, after.state.exp, '掛け直しで同じ結果にならない');
  assert.ok(fs.existsSync(CURSOR_FILE), '今度は読み位置が進んでいない');
});


test('Atomics.wait が使えない環境でも掛け直しが走る', () => {
  /*
   * Electron の main プロセスは Chromium のブラウザプロセスの上で動いていて、
   * そこでは `Atomics.wait cannot be called in this context` で落ちる
   * ── **この修正がいちばん効いてほしい環境で、掛け直しが 1 回も走らない**。
   */
  const realWait = Atomics.wait;
  Atomics.wait = () => {
    throw new TypeError('Atomics.wait cannot be called in this context');
  };
  const restore = breakRename(2);
  try {
    const state = emptyState(1000);
    state.exp = 555;
    const began = Date.now();
    assert.equal(saveState(state), true, 'Atomics が無いと保存できない');
    assert.equal(loadState().exp, 555);
    // 待ってから掛け直している（20 + 40ms 以上）
    assert.ok(Date.now() - began >= 50, '待たずに掛け直している');
  } finally {
    restore();
    Atomics.wait = realWait;
  }
  assert.deepEqual(tmpFiles(), [], '一時ファイルが残っている');
});

test.after(() => {
  fs.rmSync(HOME, { recursive: true, force: true });
});
