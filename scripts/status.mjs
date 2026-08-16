#!/usr/bin/env node
/**
 * いまの状態を、ターミナルで読む。
 *
 *   node scripts/status.mjs
 *
 * **オーバーレイを立ち上げずに済ませるためのもの。** GUI が出ない環境
 * （SSH の先、CI、Electron が起動できない箱）でも、育っているかどうかは
 * 見たい ── 見えないと「動いていないのか、育っていないのか」が切り分けられない。
 *
 * `~/.aipet/events.jsonl` をその場で畳むだけで、何も書かない。
 * `state.json` にも触らないので、オーバーレイと同時に動かして構わない。
 */
import fs from 'node:fs';
import { EVENTS_FILE, PUSH_CURSOR_FILE, SYNC_STATUS_FILE, SERVE_FILE } from '../src/core/paths.js';
import { emptyState, applyEvents, levelForExp, DAILY_EXP_CAP } from '../src/core/growth.js';
import { viewModel } from '../src/core/view.js';
import { loadConfig } from '../src/core/config.js';
import { skinFor } from '../src/core/wardrobe.js';

let lines;
try {
  lines = fs.readFileSync(EVENTS_FILE, 'utf8').split('\n').filter(Boolean);
} catch {
  console.error(`× まだ記録がありません: ${EVENTS_FILE}`);
  console.error('  Claude Code を hook 入りで一度動かすと溜まりはじめます。');
  process.exit(0);
}

const events = lines
  .map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  })
  .filter(Boolean)
  .sort((a, b) => a.t - b.t);

if (!events.length) {
  console.error('× 記録が空です。');
  process.exit(0);
}

const config = loadConfig();
const state = applyEvents(emptyState(events[0].t), events);
const view = viewModel(state, Date.now(), {
  name: config.name,
  lang: config.lang,
  skin: skinFor(config).id,
});

const n = (value) => Number(value || 0).toLocaleString(config.lang === 'ja' ? 'ja-JP' : 'en-US');
const day = (t) => new Date(t).toLocaleDateString();

console.log(`\n  ${view.name}  Lv${view.level}   ${view.persona.settled ? view.persona.title : ''}`);
console.log(`  ${view.into} / ${view.span} EXP    ${view.text['level.next']}`);
console.log(`  今日 ${n(view.dailyExp)} / ${n(DAILY_EXP_CAP)} EXP${view.dailyExp >= DAILY_EXP_CAP ? '  ← 上限に届いています' : ''}`);

console.log(`\n  系統      ${view.className || '（まだ決まっていない）'}`);
console.log(`  地下      ${n(view.dungeon.floor)} 階   主 ${view.dungeon.bosses.length} 体`);
console.log(`  装備      ${view.dungeon.equipped.map((e) => `${e.label}(${e.rarityLabel})`).join('  ') || 'なし'}`);
console.log(`  技        ${view.skills.map((s) => `${s.label}${'★'.repeat(s.tier)}`).join('  ') || 'まだ生えていない'}`);
console.log(`  実績      ${view.text['achievement.count']}`);
console.log(`  スキン    ${view.skin.label}`);

console.log('\n  これまで');
console.log(`    ツール      ${n(state.traits.toolCalls)} 回`);
console.log(`    指示        ${n(state.traits.prompts)} 件`);
console.log(`    セッション  ${n(state.traits.sessions)} 本`);
console.log(`    立て直し    ${n(state.traits.comebacks)} 回`);
console.log(`    長丁場      ${n(state.traits.compacts)} 回`);

console.log(`\n  記録 ${n(events.length)} 件（${day(events[0].t)} 〜 ${day(events[events.length - 1].t)}）`);
console.log(`  ${EVENTS_FILE}`);

/*
 * **手元のログだけでは片側しか見えない。**
 *
 * クラウドの Claude Code で働いたぶんは、その箱の `events.jsonl` に溜まって
 * サーバーへ送られる ── この PC には来ない。合流した数字を持っているのは
 * サーバーだけで、オーバーレイもそちらを取りに行って高いほうを出している
 * （main.js の currentView）。
 *
 * ここで出さないと「PC では Lv3 なのにスマホは Lv10」が説明できないまま残る。
 */
/**
 * LAN 配信のアドレス。**オーバーレイが書いたものを、ここから読める形で出す。**
 *
 * Windows の Electron はコンソールに UTF-8 のまま吐くので、日本語環境
 * （CP932）だと案内ごと化けて **肝心の URL が読めない** ── ここ（node）は
 * 化けないので、読める側から出す。
 *
 * 古い控えは出さない。閉じたあとのアドレスを案内しても繋がらない。
 */
const SERVE_FRESH_MS = 12 * 60 * 60 * 1000;

function showLan() {
  let serve;
  try {
    serve = JSON.parse(fs.readFileSync(SERVE_FILE, 'utf8'));
  } catch {
    return;
  }
  if (!serve || !serve.at || Date.now() - serve.at > SERVE_FRESH_MS) return;
  const lan = Array.isArray(serve.urls) ? serve.urls : [];
  if (!serve.local && !lan.length) return;

  console.log('\n  いま、この PC が直接出しています（サーバーを通りません）');
  // **この PC で開く口を先に出す。** ファイアウォールにも Wi-Fi にも左右されない
  if (serve.local) console.log(`    このパソコン    ${serve.local}`);
  for (const url of lan) console.log(`    スマホ          ${url}`);
}

if (!config.enabled) {
  console.log('\n  （同期はオフ。この PC のぶんだけです）');
  showLan();
  console.log('');
  process.exit(0);
}

/*
 * **送れているかどうかを出す。** 送信は detached の別プロセスなので、
 * 失敗しても画面にもログにも出ない ── 実際、クラウドの箱が 2,951 件を
 * 抱えたまま一度も送れておらず、「クラウドで働いていない人」とまったく
 * 同じ数字が出ていた。**送れていないことが分からないのが、いちばん困る。**
 */
const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

const sync = readJson(SYNC_STATUS_FILE);
const cursor = readJson(PUSH_CURSOR_FILE);

/*
 * **どれだけ残っているかを、記録ファイル抜きでも出す。**
 *
 * `sync-status.json` は新しい版の hook が一度動いて初めてできるので、それを
 * 前提にすると「送れているのに何も出ない」空白になる（実際そうなった）。
 * 送信位置は `push-cursor.json` の**バイト位置**なので、ログの大きさと
 * 引き算すれば、記録が無くても未送信の件数はその場で数えられる。
 */
const size = fs.statSync(EVENTS_FILE).size;
const offset = cursor && Number.isFinite(cursor.offset) ? cursor.offset : 0;
let waiting = events.length;
if (offset > 0 && offset <= size) {
  const rest = fs.readFileSync(EVENTS_FILE).subarray(offset).toString('utf8');
  waiting = rest.split('\n').filter((line) => line.trim()).length;
}

console.log('\n  送信');
if (sync && sync.ok === false) {
  const why = sync.status ? `HTTP ${sync.status}` : sync.error || '不明';
  console.log(`    × 失敗しています（${why}）  最後の試み ${new Date(sync.t).toLocaleString()}`);
} else if (sync && sync.ok) {
  console.log(`    ○ ${new Date(sync.t).toLocaleString()} に ${n(sync.sent || 0)} 件`);
} else if (offset > 0) {
  console.log('    ○ 送れています（結果の記録はこの版から始まります）');
} else {
  console.log('    まだ一度も送れていません');
}
console.log(waiting > 0 ? `    未送信 ${n(waiting)} 件` : '    未送信なし（全部サーバーに入っています）');

/*
 * **スマホ用の URL をここに出す。** どこにも出していなかったので、
 * 見るには config.json を開いてトークンを自分で繋ぐしかなかった
 * ── 手順を思い出さないと開けないものは、結局開かれない。
 *
 * ここまで来ているなら endpoint と token は両方揃っている（揃っていないと
 * config.enabled が false になって、上で抜けている）。
 */
console.log('\n  スマホ');
console.log(`    ${config.endpoint}/p/${config.token}`);
console.log('    ↑ これをブックマーク。トークンが入っているので、人に見せない');
showLan();

try {
  const res = await fetch(`${config.endpoint}/api/state`, {
    headers: { authorization: `Bearer ${config.token}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const merged = await res.json();
  console.log('\n  合流後（サーバー ── クラウドで働いたぶんも入る）');
  console.log(`    ${merged.name}  Lv${merged.level}   ${n(merged.exp)} EXP`);
  console.log(`    地下 ${n(merged.dungeon?.floor ?? 0)} 階   ツール ${n(merged.traits?.toolCalls)} 回   セッション ${n(merged.traits?.sessions)} 本`);
  if (merged.exp > state.exp) {
    console.log('    ← オーバーレイとスマホには、こちらの数字が出ます');
  }
  console.log('');
} catch (error) {
  // 圏外・サーバー停止・トークン違い。ここで止める理由は無い
  console.log(`\n  （サーバーに繋がりませんでした: ${error.message}）\n`);
}
