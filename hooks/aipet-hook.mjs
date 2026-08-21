#!/usr/bin/env node
/**
 * aipet の唯一の入力口。Claude Code の hook から呼ばれる。
 *
 * ここでの掟が 3 つある。守れないと本体の邪魔になる。
 *
 *   1. 絶対に exit 0。hook が非 0 を返すと Claude Code の動作をブロックする。
 *      aipet はおまけなので、何が起きても本体を止めてはいけない。
 *   2. 待たない。1 行 append して即終わる。送信も成長の計算もここではやらない。
 *      hook は同期でブロックするので、ここが重いと Claude Code が待たされる。
 *   3. 中身を保存しない。プロンプト本文・ツール引数・パスは 1 バイトも書かない。
 *      残すのは「何が起きたか」の派生値だけ。
 *
 * このファイルは Node の標準モジュールしか使わない。クラウドの Claude Code は
 * コンテナが毎回作り直されてリポジトリの中しか無いので、これ 1 枚をリポジトリに
 * 置けばそのまま動く必要がある（→ cloud/README.md）。
 *
 *   node aipet-hook.mjs <EventName>   hook から。stdin に hook の JSON
 *   node aipet-hook.mjs --push        溜まったぶんをサーバーに送る
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.AIPET_HOME || path.join(os.homedir(), '.aipet');
const EVENTS_FILE = path.join(ROOT, 'events.jsonl');
const PUSH_CURSOR = path.join(ROOT, 'push-cursor.json');
// 送信の結果を 1 行だけ残す先（下の noteSync）
const SYNC_STATUS = path.join(ROOT, 'sync-status.json');

const SELF = fileURLToPath(import.meta.url);

/** 送信を仕掛けるタイミング。ツール 1 回ごとだと頻度が高すぎる。 */
const PUSH_ON = new Set(['Stop', 'SessionEnd', 'PreCompact']);

/** 1 回のリクエストで送るイベント数の上限。 */
const BATCH = 500;
const PUSH_TIMEOUT_MS = 15000;

/* ────────────────────────────── 記録する ────────────────────────────── */

/** stdin が閉じない事故で Claude Code を待たせないための保険。 */
function bailoutTimer() {
  const t = setTimeout(() => process.exit(0), 800);
  t.unref?.();
  return t;
}

function shortHash(value) {
  if (!value) return null;
  return crypto.createHash('sha1').update(String(value)).digest('hex').slice(0, 8);
}

/**
 * ツールが失敗したかどうかの推定。
 * hook の tool_response は形が揃っていないので、確実に分かる場合だけ false を返す。
 * 判定できないときは「失敗ではない」に倒す ── 誤って失敗扱いにするより無害。
 */
function succeeded(response) {
  if (response == null) return true;
  if (typeof response !== 'object') return true;
  if (response.interrupted === true) return false;
  if (response.is_error === true) return false;
  if (typeof response.error === 'string' && response.error.length > 0) return false;
  return true;
}

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
      // 想定外に巨大な入力は打ち切る。どうせ使うのは数フィールドだけ。
      if (data.length > 1_000_000) resolve(data.slice(0, 1_000_000));
    });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(''));
  });
}

async function record() {
  // --cloud はリポジトリ内の .claude/settings.json から呼ばれた印。
  //
  // PC ではユーザー設定（~/.claude/settings.json）の hook が既に動いているので、
  // そこへリポジトリ側の hook まで発火すると 1 つの操作が 2 回記録されて
  // EXP が倍になる。クラウドのコンテナにはユーザー設定が無く、代わりに
  // 環境変数で設定を渡すので、それが無い環境では黙って何もしない。
  //
  // 🔴 **箱ごと入れてある場合も、リポジトリ側は黙る。**
  //    cloud-setup.sh は ~/.claude/settings.json に入れる（作業場所が
  //    どこでも効くように）。そこへリポジトリ側まで発火すると、
  //    合言葉のあるクラウドの箱で 1 つの操作が 2 回記録される
  //    ── しかも 2 回の `i` は別々の乱数なので、サーバー側の重複弾きも
  //    すり抜ける。箱ごとの仕掛けが居るなら、そちらに任せる。
  if (process.argv.includes('--cloud')) {
    if (!process.env.AIPET_ENDPOINT) return;
    const kit = path.join(os.homedir(), '.maite-hook', 'hooks', 'aipet-hook.mjs');
    if (fs.existsSync(kit)) return;
  }

  const timer = bailoutTimer();
  const raw = await readStdin();
  clearTimeout(timer);

  let payload = {};
  try {
    payload = JSON.parse(raw) || {};
  } catch {
    payload = {};
  }

  // 通常は hook の JSON にイベント名が入っている。無い場合の保険として
  // 引数を見るが、--cloud のようなフラグを拾わないよう先頭から除く。
  const argName = process.argv.slice(2).find((a) => !a.startsWith('--'));
  const kind = payload.hook_event_name || argName || 'Unknown';

  const entry = {
    // 複数の場所（PC / クラウドのセッション）から同じ記録が届いても
    // 二重に数えないための ID。再送が安全になる。
    i: crypto.randomBytes(6).toString('hex'),
    t: Date.now(),
    e: kind,
    // セッションとプロジェクトは「別物かどうか」が分かれば十分なのでハッシュだけ。
    // cwd を平文で持たない = リポジトリ名も職場も漏れない。
    s: shortHash(payload.session_id),
    p: shortHash(payload.cwd),
  };

  if (payload.tool_name) entry.tool = payload.tool_name;
  if (kind === 'PostToolUse') entry.ok = succeeded(payload.tool_response);
  // 本文は保存しない。長さの目安だけ 3 段階で持つ。
  if (typeof payload.prompt === 'string') {
    const n = payload.prompt.length;
    entry.size = n < 80 ? 's' : n < 600 ? 'm' : 'l';
  }

  fs.mkdirSync(ROOT, { recursive: true });
  fs.appendFileSync(EVENTS_FILE, JSON.stringify(entry) + '\n');

  if (PUSH_ON.has(kind)) schedulePush();
}

/**
 * 送信は完全に切り離した別プロセスでやる。
 *
 * hook は Claude Code を同期でブロックするので、ここでネットワークを待つと
 * 本体が待たされる。detached + unref で投げっぱなしにし、結果を一切待たない。
 * 同期が未設定なら、起きた側が即終了する。
 */
function schedulePush() {
  if (!process.env.AIPET_ENDPOINT && !fs.existsSync(path.join(ROOT, 'config.json'))) return;
  try {
    const child = spawn(process.execPath, [SELF, '--push'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
  } catch {
    // 仕掛けられなくても記録は残っている。次の区切りで送られる。
  }
}

/* ────────────────────────────── 送る ────────────────────────────── */

function loadConfig() {
  let file = {};
  try {
    // PowerShell の Set-Content -Encoding UTF8 は BOM を付ける。
    // 剥がさないと JSON.parse が落ちて、同期が黙って効かなくなる。
    file = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8').replace(/^﻿/, '')) || {};
  } catch {
    file = {};
  }
  const endpoint = process.env.AIPET_ENDPOINT || file.endpoint || null;
  const token = process.env.AIPET_TOKEN || file.token || null;
  // 付け替えた名前。**本人が決めたものだけ**を送る（ログから作った値ではない）。
  const name = process.env.AIPET_NAME || file.name || null;
  const lang = process.env.AIPET_LANG || file.lang || null;
  /*
   * 見た目（スキン）も一緒に送る。**送るのは id だけで、鍵は送らない。**
   *
   * 鍵を確かめるのはオーバーレイ側（wardrobe.js）── サーバーで確かめようと
   * すると Worker に `node:crypto` が要り、そこで本番が落ちる。id を絵に
   * 落とすだけならサーバーは何も確かめなくていい。
   *
   * ここは hook（依存ゼロの 1 枚もの）なので、着られるかどうかの判定はしない
   * ── 設定の値をそのまま送る。オーバーレイが起動していれば、そちらが
   * 決めた id で上書きされる。
   */
  const skin = process.env.AIPET_SKIN || file.skin || null;
  return { endpoint: endpoint ? endpoint.replace(/\/+$/, '') : null, token, name, lang, skin };
}

/**
 * 未送信のぶんを読む。
 *
 * cursor は「実際に読んだ行までの位置」で止める。ここがずれると、
 * 件数で区切ったときに同じ範囲を延々と送り直すことになる。
 */
function readUnsent() {
  let size = 0;
  try {
    size = fs.statSync(EVENTS_FILE).size;
  } catch {
    return null;
  }

  let from = 0;
  try {
    from = JSON.parse(fs.readFileSync(PUSH_CURSOR, 'utf8')).offset || 0;
  } catch {
    from = 0;
  }
  if (size < from) from = 0; // ログが消された・作り直された
  if (size === from) return null;

  const fd = fs.openSync(EVENTS_FILE, 'r');
  const buf = Buffer.allocUnsafe(size - from);
  fs.readSync(fd, buf, 0, size - from, from);
  fs.closeSync(fd);

  const text = buf.toString('utf8');
  // 末尾が改行で終わっていない = 書き込み途中。その 1 行は次回に回す。
  const lastNl = text.lastIndexOf('\n');
  if (lastNl === -1) return null;

  const events = [];
  let consumed = 0;
  for (const line of text.slice(0, lastNl).split('\n')) {
    if (events.length >= BATCH) break;
    consumed += Buffer.byteLength(line, 'utf8') + 1;
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      // 壊れた行は捨てる
    }
  }
  if (!events.length) return null;
  return { events, offset: from + consumed };
}

/*
 * 送信の結果を 1 行だけ残す。**送れていないことが誰にも分からないのが、
 * 送れていないことより悪い。**
 *
 * 送信は detached の別プロセスなので、`console.error` はどこにも出ない
 * ── 実際、クラウドの箱が 2,951 件を抱えたまま一度も送れておらず、
 * 画面には「クラウドで働いていない人」とまったく同じ数字が出ていた。
 *
 * 中身は書かない（件数と HTTP の状態だけ）。プライバシーの線は §2b のまま。
 */
function noteSync(result) {
  try {
    fs.writeFileSync(SYNC_STATUS, JSON.stringify({ t: Date.now(), ...result }));
  } catch {
    // 記録できなくても送信は送信。ここで止めない
  }
}

async function push() {
  const { endpoint, token, name, lang, skin } = loadConfig();
  if (!endpoint || !token) return;

  const pending = readUnsent();
  if (!pending) return;

  const res = await fetch(`${endpoint}/ingest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({
      events: pending.events,
      ...(name ? { name } : {}),
      ...(lang ? { lang } : {}),
      ...(skin ? { skin } : {}),
    }),
    signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
  });

  if (!res.ok) {
    // cursor を進めない = 次回まるごと再送。イベントに ID があるので
    // 二重に届いてもサーバー側で弾かれる。
    console.error(`aipet: 送信に失敗しました (${res.status})`);
    noteSync({ ok: false, status: res.status, waiting: pending.events.length });
    return;
  }

  fs.writeFileSync(PUSH_CURSOR, JSON.stringify({ offset: pending.offset }));
  noteSync({ ok: true, sent: pending.events.length });
}

/* ────────────────────────────── 入口 ────────────────────────────── */

const task = process.argv.includes('--push') ? push() : record();

task
  .catch((err) => {
    // 何があっても本体を止めない
    if (process.argv.includes('--push')) {
      console.error(`aipet: ${err.message}`);
      // 圏外・名前が引けない・プロキシに塞がれている ── 全部ここに来る
      noteSync({ ok: false, error: String(err.message).slice(0, 200) });
    }
  })
  .finally(() => process.exit(0));
