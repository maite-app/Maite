#!/usr/bin/env node
/**
 * 着替え。**見た目だけ**で、数字には一切効かない（DESIGN.md §6c / src/core/skins.js）。
 *
 *   node scripts/skin.mjs            # いま着ているものと、着られるものを並べる
 *   node scripts/skin.mjs 熾火        # 着替える（名前でも id でも）
 *   node scripts/skin.mjs plain      # 既定に戻す
 *
 * 選んだものは設定（`config.json`）に入る ── 成長の記録ではないので、
 * events.jsonl を畳み直しても消えない。
 */
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG_FILE } from '../src/core/paths.js';
import { SKINS, DEFAULT_SKIN } from '../src/core/skins.js';
import { skinList, grantForSkin } from '../src/core/wardrobe.js';

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8').replace(/^﻿/, '')) || {};
  } catch {
    return {};
  }
}

const config = readConfig();
const lang = config.lang === 'en' ? 'en' : 'ja';
const wanted = process.argv[2];

if (!wanted) {
  for (const skin of skinList(config, lang)) {
    const mark = skin.current ? '●' : skin.owned ? '○' : '×';
    const tail = skin.owned ? '' : `  （鍵: ${grantForSkin(skin.id)}）`;
    console.log(`${mark} ${skin.label.padEnd(6)} ${skin.id.padEnd(6)} ${skin.blurb}${tail}`);
  }
  console.log('\n着替える: node scripts/skin.mjs <id または名前>');
  process.exit(0);
}

// id でも表示名でも受ける（英語で見ている人が「Ember」と打てる）
const found = SKINS.find(
  (skin) => skin.id === wanted || skin.ja === wanted || skin.en.toLowerCase() === wanted.toLowerCase(),
);
if (!found) {
  console.error(`× そんなスキンはありません: ${wanted}`);
  console.error(`  ${SKINS.map((s) => s.id).join(' / ')}`);
  process.exit(1);
}

config.skin = found.id;
fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
fs.writeFileSync(CONFIG_FILE, `${JSON.stringify(config, null, 2)}\n`);

// **着られないものを選んでも保存はする**（鍵を後から入れたときに、そのまま着る）
const entry = skinList(config, lang).find((s) => s.id === found.id);
if (entry.owned) {
  console.log(`✓ ${entry.label} に着替えました`);
} else {
  console.log(`${entry.label} を選びました（まだ鍵がないので、いまは ${DEFAULT_SKIN} のまま出ます）`);
  console.log(`  鍵: ${grantForSkin(found.id)}`);
}
