#!/usr/bin/env node
/**
 * 開発用。events.jsonl にそれっぽい作業ログを流し込む。
 *
 * 本物の Claude Code を何日も使わないと Lv が上がらないので、
 * 見た目と成長の確認はこれで回す。
 *
 *   node scripts/simulate.mjs                  # 職人として 1 日ぶん
 *   node scripts/simulate.mjs scholar 3        # 学者として 3 日ぶん
 *   node scripts/simulate.mjs --live           # 1 秒おきに流し続ける（オーバーレイの動作確認）
 *   node scripts/simulate.mjs --reset          # 全部消す
 *
 * AIPET_HOME を指定すれば本番のデータに触らずに試せる。
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, EVENTS_FILE, STATE_FILE, CURSOR_FILE, PUSH_CURSOR_FILE } from '../src/core/paths.js';
import { CLASSES, CLASS_IDS } from '../src/core/classes.js';

const args = process.argv.slice(2);

if (args.includes('--reset')) {
  for (const f of [EVENTS_FILE, STATE_FILE, CURSOR_FILE, PUSH_CURSOR_FILE]) fs.rmSync(f, { force: true });
  console.log(`✓ ${ROOT} のデータを消しました。`);
  process.exit(0);
}

fs.mkdirSync(ROOT, { recursive: true });

const live = args.includes('--live');
const positional = args.filter((a) => !a.startsWith('--'));
const classId = CLASS_IDS.includes(positional[0]) ? positional[0] : 'artisan';
const days = Number(positional[1]) || 1;

const OTHER_TOOLS = ['Read', 'Grep', 'Bash', 'Edit', 'WebSearch', 'Task'];

function append(record) {
  fs.appendFileSync(EVENTS_FILE, JSON.stringify(record) + '\n');
}

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

if (live) {
  console.log(`▶ ${CLASSES[classId].ja} として 1 秒おきに流します。Ctrl+C で停止。`);
  append({ t: Date.now(), e: 'SessionStart', s: 'sim00000', p: 'sim00000' });
  setInterval(() => {
    const roll = Math.random();
    if (roll < 0.1) {
      append({ t: Date.now(), e: 'UserPromptSubmit', s: 'sim00000', p: 'sim00000', size: 'm' });
    } else if (roll < 0.15) {
      append({ t: Date.now(), e: 'Notification', s: 'sim00000', p: 'sim00000' });
    } else if (roll < 0.17) {
      // 長丁場。これが無いと「記憶術」が一度も生えない
      append({ t: Date.now(), e: 'PreCompact', s: 'sim00000', p: 'sim00000' });
    } else {
      // 8 割はその系統のツール、2 割はよそ見
      const tool = Math.random() < 0.8 ? pick(CLASSES[classId].tools) : pick(OTHER_TOOLS);
      append({ t: Date.now(), e: 'PostToolUse', s: 'sim00000', p: 'sim00000', tool, ok: Math.random() > 0.12 });
    }
  }, 1000);
} else {
  const DAY = 24 * 60 * 60 * 1000;
  let written = 0;
  for (let d = days - 1; d >= 0; d -= 1) {
    // 「その日の作業」を過去の日付に置く。日次 EXP キャップが日ごとに効く。
    const base = Date.now() - d * DAY;
    append({ t: base, e: 'SessionStart', s: `sim${d}`, p: 'sim00000' });
    written += 1;
    for (let i = 0; i < 300; i += 1) {
      const t = base + i * 1000;
      if (i % 25 === 0) {
        append({ t, e: 'UserPromptSubmit', s: `sim${d}`, p: 'sim00000', size: 'm' });
      } else if (i % 140 === 0) {
        // 長丁場をまたぐ。これが無いと「記憶術」が一度も生えず、
        // 弱体を振り払う相手との噛み合いを捏造ログで確かめられない
        append({ t, e: 'PreCompact', s: `sim${d}`, p: 'sim00000' });
      } else {
        const tool = Math.random() < 0.8 ? pick(CLASSES[classId].tools) : pick(OTHER_TOOLS);
        append({ t, e: 'PostToolUse', s: `sim${d}`, p: 'sim00000', tool, ok: Math.random() > 0.12 });
      }
      written += 1;
    }
    append({ t: base + 300_000, e: 'Stop', s: `sim${d}`, p: 'sim00000' });
    written += 1;
  }
  console.log(`✓ ${CLASSES[classId].ja} として ${days} 日ぶん (${written} 件) を書きました。`);
  console.log(`  ${EVENTS_FILE}`);
}
