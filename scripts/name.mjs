#!/usr/bin/env node
/**
 * 名前を付け替える。
 *
 *   node scripts/name.mjs            # いまの名前を見る
 *   node scripts/name.mjs さくら     # 付け替える
 *   node scripts/name.mjs --reset    # 働き方から付く名前に戻す
 *
 * **既定の名前は型（persona.js）から出る。** 働き方が変われば名前のほうが変わるので、
 * ここで付け替えるのは「変わってほしくない人」向け。
 *
 * **起動時に名前は訊かない**（DESIGN.md §1）。付けたい人だけがここで付ける。
 *
 * 置き場所は `~/.aipet/config.json`。state ではないのは、state が
 * events.jsonl から作り直せるもので、ルールを変えて畳み直すたびに消えるから。
 */
import fs from 'node:fs';
import { ROOT, CONFIG_FILE, STATE_FILE } from '../src/core/paths.js';
import { loadConfig } from '../src/core/config.js';
import { nameFor, sanitizeName, NAME_MAX } from '../src/core/naming.js';
import { personaFor } from '../src/core/persona.js';
import { emptyState } from '../src/core/growth.js';

const args = process.argv.slice(2);
const reset = args.includes('--reset');
const wanted = args.filter((a) => !a.startsWith('--')).join(' ');

/** 既定の名前は型（働き方）から出る。まだ畳んでいなければ「見習い」。 */
function currentPersona() {
  try {
    return personaFor(JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')));
  } catch {
    return personaFor(emptyState(Date.now()));
  }
}

const persona = currentPersona();
const config = loadConfig();

if (!reset && !wanted) {
  const now = nameFor(persona, config.name);
  console.log(`いまの名前: ${now}${config.name ? '（付け替えた名前）' : '（働き方から付いた名前）'}`);
  console.log(`働き方から出る名前: ${nameFor(persona)}${persona.settled ? `（${persona.blurb}）` : '（まだ見極め中）'}`);
  console.log('\n付け替える: node scripts/name.mjs 名前');
  console.log('既定に戻す: node scripts/name.mjs --reset');
  process.exit(0);
}

const name = reset ? null : sanitizeName(wanted);
if (!reset && !name) {
  console.error(`× 名前として置けません（空か、制御文字だけ）。${NAME_MAX} 文字までです。`);
  process.exit(1);
}

let file = {};
try {
  file = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8').replace(/^﻿/, '')) || {};
} catch {
  file = {};
}

if (name) file.name = name;
else delete file.name;

fs.mkdirSync(ROOT, { recursive: true });
fs.writeFileSync(CONFIG_FILE, `${JSON.stringify(file, null, 2)}\n`);

if (name) {
  console.log(`✓ ${name} になりました（${CONFIG_FILE}）`);
  if (wanted !== name) console.log(`  ${wanted} は長さと制御文字を落として ${name} にしています`);
} else {
  console.log(`✓ 働き方から付く名前に戻しました: ${nameFor(persona)}`);
}
console.log('  オーバーレイは 30 秒以内に、スマホは次の送信で追いつきます');
