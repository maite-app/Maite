import fs from 'node:fs';
import path from 'node:path';
import { ROOT, STATE_FILE, EVENTS_FILE, CURSOR_FILE } from './paths.js';
import { emptyState, applyEvents, STATE_VERSION } from './growth.js';

export function ensureRoot() {
  fs.mkdirSync(ROOT, { recursive: true });
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

/**
 * Windows で rename が一時的に弾かれるときのコード。
 *
 * ウイルス対策・検索インデクサ・OneDrive の同期・もう 1 つ立ち上がっている
 * オーバーレイ ── どれかが同じ瞬間にファイルを開いていると、上書きの rename が
 * **EPERM で落ちる**。POSIX と違って Windows の rename は「開かれている宛先」に
 * 被せられない。数十ミリ秒後には空いていることがほとんど。
 */
const BUSY = new Set(['EPERM', 'EACCES', 'EBUSY', 'ENOTEMPTY']);

/** 何回まで待って掛け直すか（20 / 40 / 80 / 160 / 320ms）。 */
const RENAME_TRIES = 5;

/**
 * 同期で少しだけ待つ。常駐の保存は数秒に 1 回なので、ここは止めて構わない。
 *
 * **Atomics.wait が使えないことがある。** Electron の main プロセスは
 * Chromium のブラウザプロセスの上で動いていて、そこでは
 * `Atomics.wait cannot be called in this context` で落ちる ── つまり
 * **この修正がいちばん効いてほしい環境で、掛け直しが 1 回も走らない**。
 * 投げられたら、時計を見て回るほうに落とす（合計 620ms が上限）。
 */
function sleep(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      // 何もしない。ここに来るのは rename が弾かれた後だけ
    }
  }
}

/**
 * 書き込みは常に一時ファイル経由。落ちても state.json が壊れないようにする。
 *
 * **Windows では rename が転ける。** 実際に出た：
 *
 *     Error: EPERM: operation not permitted,
 *     rename 'C:\Users\...\.aipet\state.json.22292.tmp' -> '...\state.json'
 *
 * 直し方は 2 段。まず**少し待って掛け直す**（上の BUSY / RENAME_TRIES）。
 * それでも通らなければ**直接上書きに落とす** ── 原子性は失うが、`state.json` は
 * `events.jsonl` から作り直せるただの控えで、途中で切れても `loadState` が
 * 読めずに畳み直すだけ。**アプリが死ぬほうがずっと悪い。**
 */
function writeJsonAtomic(file, value) {
  ensureRoot();
  const text = JSON.stringify(value, null, 2);
  const tmp = path.join(ROOT, `.${path.basename(file)}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, text);

  for (let attempt = 0; attempt < RENAME_TRIES; attempt += 1) {
    try {
      fs.renameSync(tmp, file);
      return;
    } catch (error) {
      if (!BUSY.has(error.code) || attempt === RENAME_TRIES - 1) break;
      sleep(20 * 2 ** attempt);
    }
  }

  // 掛け直しても駄目だった。原子性を捨てて直接書く
  try {
    fs.writeFileSync(file, text);
  } finally {
    // 一時ファイルを残さない（残すと ~/.aipet が .tmp だらけになる）
    fs.rmSync(tmp, { force: true });
  }
}

/**
 * 成長ルールを変えたら、保存済みの state は古いルールの産物なので捨てる。
 * cursor も 0 に戻すことで events.jsonl 全体が新ルールで畳み直される
 * ── applyEvent を純関数にしてあるのは、この移行を「作り直す」で済ませるため。
 */
export function loadState() {
  const saved = readJson(STATE_FILE, null);
  if (!saved) return emptyState();
  if (saved.version !== STATE_VERSION) {
    fs.rmSync(CURSOR_FILE, { force: true });
    return emptyState(saved.bornAt || Date.now());
  }
  return saved;
}

/**
 * 保存する。**失敗しても投げない。**
 *
 * `state.json` は `events.jsonl` から作り直せるただの控えなので、1 回書けなくても
 * 次の周回で書ければ何も失われない。ここで例外が外に出ると Electron の
 * main プロセスが落ちて、**「保存に失敗しただけでアプリが死ぬ」**
 * ── 実際に Windows の EPERM でそうなった（画面いっぱいのエラーダイアログ）。
 *
 * 返り値で成否だけ伝える。呼ぶ側は、失敗したら cursor を進めない
 * （進めると、そのぶんのイベントが二度と畳まれない）。
 */
export function saveState(state) {
  try {
    writeJsonAtomic(STATE_FILE, state);
    return true;
  } catch (error) {
    // 黙って捨てない。ただし止めもしない（相棒のためにアプリを殺さない）
    console.error(`[aipet] state を保存できませんでした（次の周回で掛け直します）: ${error.code || error.message}`);
    return false;
  }
}

function loadCursor(file) {
  return readJson(file, { offset: 0 });
}

/** cursor も同じ扱い。書けなくても止めない（次の周回で同じ範囲を読み直すだけ）。 */
function saveCursor(file, cursor) {
  try {
    writeJsonAtomic(file, cursor);
    return true;
  } catch (error) {
    console.error(`[aipet] 読み位置を保存できませんでした: ${error.code || error.message}`);
    return false;
  }
}

/**
 * events.jsonl の未読分だけを読む。
 *
 * ログは追記のみなので、前回の offset から先を読めばいい。
 * ファイルが縮んでいたら（ローテートや手動削除）先頭から読み直し、
 * state も作り直す ── 半端に混ざるより作り直したほうが安全。
 */
export function drainEvents(cursorFile = CURSOR_FILE) {
  ensureRoot();
  let size = 0;
  try {
    size = fs.statSync(EVENTS_FILE).size;
  } catch {
    return { events: [], reset: false, commit: () => {} };
  }

  const cursor = loadCursor(cursorFile);
  let reset = false;
  let from = cursor.offset;
  if (size < from) {
    from = 0;
    reset = true;
  }
  if (size === from) return { events: [], reset: false, commit: () => {} };

  const fd = fs.openSync(EVENTS_FILE, 'r');
  const length = size - from;
  const buf = Buffer.allocUnsafe(length);
  fs.readSync(fd, buf, 0, length, from);
  fs.closeSync(fd);

  const text = buf.toString('utf8');
  // 末尾が改行で終わっていない = 書き込み途中。その 1 行は次回に回す。
  const lastNl = text.lastIndexOf('\n');
  if (lastNl === -1) return { events: [], reset, commit: () => {} };
  const complete = text.slice(0, lastNl);

  const events = [];
  let consumed = 0;
  for (const line of complete.split('\n')) {
    consumed += Buffer.byteLength(line, 'utf8') + 1;
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      // 壊れた行は捨てる。ペットのために本体を止める価値はない。
    }
  }

  // commit を呼び出し側に委ねているのは送信のため。送信が失敗したのに
  // cursor を進めてしまうと、そのぶんが永久に届かなくなる。
  const commit = () => saveCursor(cursorFile, { offset: from + consumed });
  return { events, reset, commit };
}

/**
 * 未読イベントを取り込んで state を更新し、新しい state を返す。
 *
 * **保存できなかったら cursor を進めない。** 進めてしまうと、そのぶんの
 * イベントは「読んだことになったのに畳まれていない」状態で永久に落ちる。
 * 進めなければ、次の周回で同じ範囲をもう一度読んで畳み直すだけで済む。
 *
 * 畳んだ結果は保存の成否に関わらず返す ── 画面はもう新しい数字を出していい。
 */
export function tick(current) {
  const { events, reset, commit } = drainEvents();
  if (!events.length && !reset) return { state: current, changed: false };
  const base = reset ? emptyState(current.bornAt) : current;
  const next = applyEvents(base, events);
  if (saveState(next)) commit();
  return { state: next, changed: true };
}
