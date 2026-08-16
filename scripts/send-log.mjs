#!/usr/bin/env node
/**
 * 別の箱で溜まった記録を、こちらからサーバーに送る。
 *
 *   node scripts/send-log.mjs cloud-events.jsonl        # 送る
 *   node scripts/send-log.mjs cloud-events.jsonl --dry  # 何を送るか見るだけ
 *
 * **こういう箱がある。** クラウドの Claude Code は、環境のネットワーク方針で
 * 外に出られないことがある（自分の Worker への CONNECT が
 * policy denial で 403）。そうなると、その箱の `events.jsonl` は何千件溜まっても
 * 1 件も届かない ── 実際そうなっていた。マシンを買い替えたときの引っ越しも同じ形。
 *
 * **手元の記録には触らない。** 送るのは渡されたファイルだけで、
 * `~/.aipet/events.jsonl` も `push-cursor.json` も読み書きしない。合流は
 * サーバー側でやる（生ログを全部畳み直す仕組みが元からある）。
 *
 * **二度送っても増えない。** イベントには `i`（ID）が付いていて、無いものは
 * 中身から作られる（worker.js の derivedId）── 畳むときに重複が落ちる。
 * 途中で切れたら、もう一度同じファイルを送り直せばいい。
 */
import fs from 'node:fs';
import { loadConfig } from '../src/core/config.js';

/** 1 回に送れる上限（worker.js の MAX_BATCH）。超えたぶんは黙って落ちる。 */
const BATCH = 500;

const file = process.argv.find((a, i) => i >= 2 && !a.startsWith('--'));
const dry = process.argv.includes('--dry');

if (!file) {
  console.error('使い方: node scripts/send-log.mjs <events.jsonl> [--dry]');
  process.exit(1);
}

const config = loadConfig();
if (!config.enabled) {
  console.error('× 同期の設定がありません（endpoint と token の両方が要ります）。');
  console.error('  ~/.aipet/config.json か、AIPET_ENDPOINT / AIPET_TOKEN で。');
  process.exit(1);
}

let text;
try {
  text = fs.readFileSync(file, 'utf8');
} catch (error) {
  console.error(`× 読めませんでした: ${file}`);
  console.error(`  ${error.message}`);
  process.exit(1);
}

const events = text
  .split('\n')
  .filter((line) => line.trim())
  .map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  })
  // 壊れた行は捨てる。1 行のために全部を止める価値はない
  .filter((e) => e && Number.isFinite(e.t) && typeof e.e === 'string')
  .sort((a, b) => a.t - b.t);

if (!events.length) {
  console.error('× 送れるイベントがありませんでした。');
  process.exit(1);
}

const day = (t) => new Date(t).toLocaleDateString();
const n = (v) => Number(v).toLocaleString('ja-JP');

console.log(`${file}`);
console.log(`  ${n(events.length)} 件（${day(events[0].t)} 〜 ${day(events[events.length - 1].t)}）`);
console.log(`  → ${config.endpoint}`);

if (dry) {
  console.log('\n（見ているだけです。実際に送るなら --dry を外す）');
  process.exit(0);
}

let sent = 0;
for (let i = 0; i < events.length; i += BATCH) {
  const batch = events.slice(i, i + BATCH);
  let res;
  try {
    res = await fetch(`${config.endpoint}/ingest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${config.token}` },
      body: JSON.stringify({ events: batch }),
      signal: AbortSignal.timeout(30000),
    });
  } catch (error) {
    console.error(`\n× ${n(sent)} 件まで送ったところで切れました: ${error.message}`);
    console.error('  同じファイルをもう一度送れば、続きから入ります（重複は落ちます）。');
    process.exit(1);
  }

  if (!res.ok) {
    console.error(`\n× ${n(sent)} 件まで送ったところで断られました（HTTP ${res.status}）`);
    if (res.status === 401) console.error('  トークンが違うかもしれません。');
    console.error('  同じファイルをもう一度送れば、続きから入ります（重複は落ちます）。');
    process.exit(1);
  }

  sent += batch.length;
  process.stdout.write(`\r  送信 ${n(sent)} / ${n(events.length)}`);
}

console.log(`\n✓ ${n(sent)} 件を送りました。`);
console.log('  合流した数字は: node scripts/status.mjs');
