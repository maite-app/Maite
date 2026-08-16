#!/usr/bin/env node
/**
 * 手元の Claude Code の記録から、実際の使われ方を測る。
 *
 * バランスの数字（日次 EXP 上限、レベル曲線、技の閾値）は、いま「1 日 800
 * イベントくらい」という仮定の上に乗っている。仮定のままにせず、本物の分布で
 * 置き換えるための道具。
 *
 *   node scripts/usage.mjs           # 分布を出す
 *   node scripts/usage.mjs --days 90 # 直近 90 日だけ見る
 *
 * **出るのは数値だけ。** プロンプト本文もパスもコマンドも読み取らないし
 * 表示しない（src/core/transcripts.js が派生値しか返さない）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { eventsFromTranscript } from '../src/core/transcripts.js';
import { emptyState, applyEvents, DAILY_EXP_CAP, levelForExp } from '../src/core/growth.js';
import { CLASSES, classForTool } from '../src/core/classes.js';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : null;
};

const ROOT = process.env.CLAUDE_HOME || path.join(os.homedir(), '.claude', 'projects');
const days = Number(flag('days')) || 0;
const hash = (value) => crypto.createHash('sha1').update(value).digest('hex').slice(0, 8);

function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith('.jsonl')) out.push(full);
  }
  return out;
}

const files = walk(ROOT);
if (!files.length) {
  console.error(`× 記録が見つかりませんでした: ${ROOT}`);
  process.exit(0);
}

let events = [];
for (const file of files) {
  events.push(...eventsFromTranscript(fs.readFileSync(file, 'utf8'), hash));
}
events.sort((a, b) => a.t - b.t);

if (days > 0) {
  const from = Date.now() - days * 86400000;
  events = events.filter((e) => e.t >= from);
}

if (!events.length) {
  console.error('× 対象の期間に記録がありませんでした。');
  process.exit(0);
}

const dayKey = (t) => new Date(t).toISOString().slice(0, 10);
const byDay = new Map();
const hours = new Array(24).fill(0);
const tools = new Map();
const sessions = new Set();

for (const e of events) {
  const key = dayKey(e.t);
  if (!byDay.has(key)) byDay.set(key, []);
  byDay.get(key).push(e);
  hours[new Date(e.t).getHours()] += 1;
  if (e.s) sessions.add(e.s);
  if (e.tool) tools.set(e.tool, (tools.get(e.tool) || 0) + 1);
}

const counts = [...byDay.values()].map((list) => list.length).sort((a, b) => a - b);
const at = (q) => counts[Math.min(counts.length - 1, Math.floor(counts.length * q))];
const sum = (list) => list.reduce((a, b) => a + b, 0);

console.log(`${ROOT}`);
console.log(`記録 ${files.length} 本 / イベント ${events.length.toLocaleString('ja-JP')} 件 / セッション ${sessions.size} 本`);
console.log(`期間 ${dayKey(events[0].t)} 〜 ${dayKey(events[events.length - 1].t)}（作業した日 ${byDay.size} 日）`);

console.log('\n── 1 日あたりのイベント数');
console.log(`  中央値 ${at(0.5)}   平均 ${Math.round(sum(counts) / counts.length)}`);
console.log(`  下位 25% ${at(0.25)}   上位 25% ${at(0.75)}   最大 ${counts[counts.length - 1]}`);

console.log('\n── 1 日あたりの EXP（いまのルール）');
let capped = 0;
let raw = 0;
let kept = 0;
for (const [key, list] of byDay) {
  const before = applyEvents(emptyState(list[0].t), list);
  // 上限を外した理論値と比べる。セッション初回のボーナス（+5）も足さないと、
  // 実際に入った EXP のほうが大きくなって取りこぼしが負になる。
  const firstSeen = new Set();
  const theoretical = list.reduce((acc, e) => {
    let gain = e.e === 'UserPromptSubmit' ? 3 : e.ok === false ? 1 : 2;
    if (e.e === 'UserPromptSubmit' && e.s && !firstSeen.has(e.s)) {
      firstSeen.add(e.s);
      gain += 5;
    }
    return acc + gain;
  }, 0);
  raw += theoretical;
  kept += before.daily.exp;
  if (before.daily.exp >= DAILY_EXP_CAP) capped += 1;
  byDay.set(key, list);
}
const lost = raw > 0 ? 1 - kept / raw : 0;
console.log(`  上限 ${DAILY_EXP_CAP} に当たった日: ${capped} / ${byDay.size} 日（${Math.round((capped / byDay.size) * 100)}%）`);
console.log(`  取りこぼし: ${Math.round(lost * 100)}%`);

const perDay = kept / byDay.size;
console.log(`  実際に入る EXP: 1 日あたり平均 ${Math.round(perDay)}`);

console.log('\n── このペースで育つと');
for (const target of [10, 30, 50, 100]) {
  const need = Math.round(60 * Math.pow(target - 1, 1.75));
  const workDays = need / perDay;
  // 「作業した日」の割合から実日数に引き伸ばす
  const span = (events[events.length - 1].t - events[0].t) / 86400000 || 1;
  const activeRatio = Math.min(1, byDay.size / span);
  const realDays = workDays / Math.max(activeRatio, 0.05);
  console.log(`  Lv${String(target).padStart(3)} まで 作業日 ${Math.round(workDays)} 日 ≒ 実日数 ${Math.round(realDays)} 日`);
}
console.log(`  いまの累計だと Lv${levelForExp(kept)}`);

console.log('\n── ツールの内訳（系統ごと）');
const byClass = new Map();
for (const [tool, n] of tools) {
  const id = classForTool(tool) || 'その他';
  byClass.set(id, (byClass.get(id) || 0) + n);
}
const total = sum([...byClass.values()]);
for (const [id, n] of [...byClass].sort((a, b) => b[1] - a[1])) {
  const label = CLASSES[id] ? CLASSES[id].ja : id;
  const pct = Math.round((n / total) * 100);
  console.log(`  ${label.padEnd(5)} ${String(n).padStart(6)}  ${'█'.repeat(Math.round(pct / 2))} ${pct}%`);
}

console.log('\n── 時間帯');
const peak = Math.max(...hours);
for (let h = 0; h < 24; h += 1) {
  if (!hours[h]) continue;
  const bar = '█'.repeat(Math.round((hours[h] / peak) * 30));
  console.log(`  ${String(h).padStart(2, '0')}時 ${bar} ${hours[h]}`);
}
const night = sum(hours.slice(0, 5));
console.log(`  0〜5 時の比率: ${Math.round((night / sum(hours)) * 100)}%（「夜目」はここから生える）`);
