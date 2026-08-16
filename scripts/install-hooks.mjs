#!/usr/bin/env node
/**
 * ~/.claude/settings.json に aipet の hook を差し込む / 抜く。
 *
 *   node scripts/install-hooks.mjs            # 入れる
 *   node scripts/install-hooks.mjs --remove   # 抜く
 *
 * 既存の hook 設定は触らない。aipet の行だけを見分けて足し引きする。
 * 何度実行しても結果は同じ（冪等）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOOK_SCRIPT = path.resolve(HERE, '..', 'hooks', 'aipet-hook.mjs');
const SETTINGS = path.join(os.homedir(), '.claude', 'settings.json');

/** これが含まれているエントリを aipet のものとみなす。 */
const MARKER = 'aipet-hook.mjs';

/** matcher: null は「ツールを取らないイベント」= matcher を書かない。 */
const EVENTS = [
  ['SessionStart', null],
  ['UserPromptSubmit', null],
  ['PreToolUse', '*'],
  ['PostToolUse', '*'],
  ['Notification', null],
  ['PreCompact', null],
  ['Stop', null],
  ['SubagentStop', null],
  ['SessionEnd', null],
];

const remove = process.argv.includes('--remove');

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    // 壊れた settings.json を上書きするのが一番やってはいけないこと。
    console.error(`× ${SETTINGS} を JSON として読めませんでした。中断します。`);
    console.error(`  ${err.message}`);
    process.exit(1);
  }
}

function isOurs(entry) {
  return (entry.hooks || []).some((h) => typeof h.command === 'string' && h.command.includes(MARKER));
}

/** 既存の aipet エントリを全部落とし、空になったイベントキーも掃除する。 */
function stripOurs(hooks) {
  const out = {};
  for (const [event, entries] of Object.entries(hooks)) {
    if (!Array.isArray(entries)) {
      out[event] = entries;
      continue;
    }
    const kept = entries.filter((entry) => !isOurs(entry));
    if (kept.length) out[event] = kept;
  }
  return out;
}

/**
 * Windows でもスラッシュ区切りで書く。
 * JSON.stringify にパスを通すと C:\Users\... が "C:\\Users\\..." になり、
 * settings.json への保存でもう一段エスケープされて実行時に崩れる。
 * node は Windows でもスラッシュ区切りを受け付けるので、これが一番安全。
 */
const COMMAND_PATH = HOOK_SCRIPT.replace(/\\/g, '/');

function entryFor(event, matcher) {
  const entry = {
    hooks: [
      {
        type: 'command',
        command: `node "${COMMAND_PATH}" ${event}`,
        timeout: 5,
      },
    ],
  };
  if (matcher) entry.matcher = matcher;
  return entry;
}

const settings = readSettings();
const hooks = stripOurs(settings.hooks || {});

if (!remove) {
  if (!fs.existsSync(HOOK_SCRIPT)) {
    console.error(`× hook スクリプトが見つかりません: ${HOOK_SCRIPT}`);
    process.exit(1);
  }
  for (const [event, matcher] of EVENTS) {
    hooks[event] = [...(hooks[event] || []), entryFor(event, matcher)];
  }
}

if (Object.keys(hooks).length) settings.hooks = hooks;
else delete settings.hooks;

fs.mkdirSync(path.dirname(SETTINGS), { recursive: true });
if (fs.existsSync(SETTINGS)) fs.copyFileSync(SETTINGS, `${SETTINGS}.aipet-backup`);
fs.writeFileSync(SETTINGS, JSON.stringify(settings, null, 2) + '\n');

console.log(remove ? '✓ aipet の hook を外しました。' : `✓ aipet の hook を入れました (${EVENTS.length} 件)。`);
console.log(`  ${SETTINGS}`);
console.log('  Claude Code を再起動すると反映されます。');
